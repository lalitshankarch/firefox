/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.addons.amo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.AtomicFile
import androidx.annotation.VisibleForTesting
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import mozilla.components.concept.fetch.Client
import mozilla.components.concept.fetch.Request
import mozilla.components.concept.fetch.isSuccess
import mozilla.components.feature.addons.Addon
import mozilla.components.feature.addons.AddonsProvider
import mozilla.components.support.base.log.logger.Logger
import mozilla.components.support.ktx.kotlin.sanitizeFileName
import mozilla.components.support.ktx.kotlin.sanitizeURL
import mozilla.components.support.ktx.util.readAndDeserialize
import mozilla.components.support.ktx.util.writeString
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

internal const val API_VERSION = "api/v4"
internal const val DEFAULT_SERVER_URL = "https://services.addons.mozilla.org"
internal const val DEFAULT_COLLECTION_USER = "mozilla"
internal const val DEFAULT_COLLECTION_NAME = "7e8d6dc651b54ab385fb8791bf9dac"
internal const val COLLECTION_FILE_NAME_PREFIX = "mozilla_components_addon_collection"
internal const val COLLECTION_FILE_NAME = "${COLLECTION_FILE_NAME_PREFIX}_%s.json"
internal const val COLLECTION_FILE_NAME_WITH_LANGUAGE = "${COLLECTION_FILE_NAME_PREFIX}_%s_%s.json"
internal const val REGEX_FILE_NAMES = "$COLLECTION_FILE_NAME_PREFIX(_\\w+)?_%s.json"
internal const val MINUTE_IN_MS = 60 * 1000
internal const val DEFAULT_READ_TIMEOUT_IN_SECONDS = 20L
internal const val PAGE_SIZE = 50

/**
 * Implement an add-ons provider that uses the AMO API.
 *
 * @property context A reference to the application context.
 * @property client A [Client] for interacting with the AMO HTTP api.
 * @property serverURL The url of the endpoint to interact with e.g production, staging
 * or testing. Defaults to [DEFAULT_SERVER_URL].
 * @property collectionUser The id or name of the user owning the collection specified in
 * [collectionName], defaults to [DEFAULT_COLLECTION_USER]. This is used to retrieve the
 * featured add-ons.
 * @property collectionName The name of the collection to access, defaults to
 * [DEFAULT_COLLECTION_NAME]. This is used to retrieve the featured add-ons.
 * @property maxCacheAgeInMinutes maximum time (in minutes) the cached featured add-ons
 * should remain valid before a refresh is attempted. Defaults to -1, meaning no cache
 * is being used by default
 * @property ioDispatcher Coroutine dispatcher for IO operations.
 */
class AMOAddonsProvider(
    private val context: Context,
    private val client: Client,
    private val serverURL: String = DEFAULT_SERVER_URL,
    private val collectionUser: String = DEFAULT_COLLECTION_USER,
    private val collectionName: String = DEFAULT_COLLECTION_NAME,
    private val sortOption: SortOption = SortOption.POPULARITY_DESC,
    private val maxCacheAgeInMinutes: Long = -1,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : AddonsProvider {

    private val logger = Logger("AMOAddonsProvider")

    private val diskCacheLock = Any()

    private val scope = CoroutineScope(Dispatchers.IO)

    // Acts as an in-memory cache for the fetched addon's icons.
    @VisibleForTesting
    internal val iconsCache = ConcurrentHashMap<String, Bitmap>()

    /**
     * Interacts with the collections endpoint to provide a list of available
     * add-ons. May return a cached response, if [allowCache] is true, and the
     * cache is not expired (see [maxCacheAgeInMinutes]) or fetching from AMO
     * failed.
     *
     * See: https://addons-server.readthedocs.io/en/latest/topics/api/collections.html
     *
     * @param allowCache whether or not the result may be provided
     * from a previously cached response, defaults to true. Note that
     * [maxCacheAgeInMinutes] must be set for the cache to be active.
     * @param readTimeoutInSeconds optional timeout in seconds to use when fetching
     * available add-ons from a remote endpoint. If not specified [DEFAULT_READ_TIMEOUT_IN_SECONDS]
     * will be used.
     * @param language indicates in which language the translatable fields should be in, if no
     * matching language is found then a fallback translation is returned using the default language.
     * When it is null all translations available will be returned.
     * @throws IOException if the request failed, or could not be executed due to cancellation,
     * a connectivity problem or a timeout.
     */
    @Throws(IOException::class)
    @Suppress("NestedBlockDepth")
    override suspend fun getFeaturedAddons(
        allowCache: Boolean,
        readTimeoutInSeconds: Long?,
        language: String?,
    ): List<Addon> = withContext(ioDispatcher) {
        // We want to make sure we always use useFallbackFile = false here, as it warranties
        // that we are trying to fetch the latest localized add-ons when the user changes
        // language from the previous one.
        val cachedFeaturedAddons = if (allowCache && !cacheExpired(context, language, useFallbackFile = false)) {
            readFromDiskCache(language, useFallbackFile = false)?.loadIcons()
        } else {
            null
        }

        if (cachedFeaturedAddons != null) {
            return@withContext cachedFeaturedAddons
        }

        return@withContext try {
            fetchFeaturedAddons(readTimeoutInSeconds, language)
        } catch (e: IOException) {
            logger.error("Failed to fetch available add-ons", e)
            if (allowCache) {
                val cacheLastUpdated = getCacheLastUpdated(context, language, useFallbackFile = true)
                if (cacheLastUpdated > -1) {
                    val cache = readFromDiskCache(language, useFallbackFile = true)
                    cache?.let {
                        logger.info(
                            "Falling back to available add-ons cache from ${
                                SimpleDateFormat("yyyy-MM-dd'T'HH:mm'Z'", Locale.US).format(cacheLastUpdated)
                            }",
                        )
                        return@withContext it
                    }
                }
            }
            throw e
        }
    }

    private suspend fun fetchFeaturedAddons(
        readTimeoutInSeconds: Long?,
        language: String?,
    ): List<Addon> = withContext(ioDispatcher) {
        val langParam = if (!language.isNullOrEmpty()) {
            "&lang=$language"
        } else {
            ""
        }
        client.fetch(
            Request(
                // NB: The trailing slash after addons is important to prevent a redirect and additional request
                url = "$serverURL/$API_VERSION/accounts/account/$collectionUser/collections/$collectionName/addons/" +
                    "?page_size=$PAGE_SIZE" +
                    "&sort=${sortOption.value}" +
                    langParam,
                readTimeout = Pair(readTimeoutInSeconds ?: DEFAULT_READ_TIMEOUT_IN_SECONDS, TimeUnit.SECONDS),
                conservative = true,
            ),
        )
            .use { response ->
                if (response.isSuccess) {
                    val responseBody = response.body.string(Charsets.UTF_8)
                    return@withContext try {
                        JSONObject(responseBody).getAddonsFromCollection(language)
                            .loadIcons()
                            .also {
                                if (maxCacheAgeInMinutes > 0) {
                                    writeToDiskCache(responseBody, language)
                                }
                                deleteUnusedCacheFiles(language)
                            }
                    } catch (e: JSONException) {
                        throw IOException(e)
                    }
                } else {
                    val errorMessage = "Failed to fetch featured add-ons from collection. " +
                        "Status code: ${response.status}"
                    logger.error(errorMessage)
                    throw IOException(errorMessage)
                }
            }
    }

    /**
     * Asynchronously loads add-on icon for the given [iconUrl] and stores in the cache.
     */
    @VisibleForTesting
    internal fun loadIconAsync(addonId: String, iconUrl: String): Deferred<Bitmap?> = scope.async {
        val cachedIcon = iconsCache[addonId]
        if (cachedIcon != null) {
            logger.info("Icon for $addonId was found in the cache")
            cachedIcon
        } else if (iconUrl.isBlank()) {
            logger.info("Unable to find the icon for $addonId blank iconUrl")
            null
        } else {
            try {
                logger.info("Trying to fetch the icon for $addonId from the network")
                client.fetch(Request(url = iconUrl.sanitizeURL(), useCaches = true, conservative = true))
                    .use { response ->
                        if (response.isSuccess) {
                            response.body.useStream {
                                val icon = BitmapFactory.decodeStream(it)
                                logger.info("Icon for $addonId fetched from the network")
                                iconsCache[addonId] = icon
                                icon
                            }
                        } else {
                            // There was an network error and we couldn't fetch the icon.
                            logger.info("Unable to fetch the icon for $addonId HTTP code ${response.status}")
                            null
                        }
                    }
            } catch (e: IOException) {
                logger.error("Attempt to fetch the $addonId icon failed", e)
                null
            }
        }
    }

    @VisibleForTesting
    internal suspend fun List<Addon>.loadIcons(): List<Addon> {
        this.map {
            // Instead of loading icons one by one, let's load them async
            // so we can do multiple request at the time.
            loadIconAsync(it.id, it.iconUrl)
        }.awaitAll() // wait until all parallel icon requests finish.

        return this.map { addon ->
            addon.copy(icon = iconsCache[addon.id])
        }
    }

    @VisibleForTesting
    internal fun writeToDiskCache(collectionResponse: String, language: String?) {
        synchronized(diskCacheLock) {
            getCacheFile(context, language, useFallbackFile = false).writeString { collectionResponse }
        }
    }

    @VisibleForTesting
    internal suspend fun readFromDiskCache(
        language: String?,
        useFallbackFile: Boolean,
    ): List<Addon>? = withContext(ioDispatcher) {
        synchronized(diskCacheLock) {
            return@withContext getCacheFile(context, language, useFallbackFile).readAndDeserialize {
                JSONObject(it).getAddonsFromCollection(language)
            }
        }
    }

    /**
     * Deletes cache files from previous (now unused) collections.
     */
    @VisibleForTesting
    internal fun deleteUnusedCacheFiles(language: String?) {
        val currentCacheFileName = getBaseCacheFile(context, language, useFallbackFile = true).name

        context.filesDir
            .listFiles { _, s ->
                s.startsWith(COLLECTION_FILE_NAME_PREFIX) && s != currentCacheFileName
            }
            ?.forEach {
                logger.debug("Deleting unused collection cache: " + it.name)
                it.delete()
            }
    }

    @VisibleForTesting
    internal fun cacheExpired(context: Context, language: String?, useFallbackFile: Boolean): Boolean {
        return getCacheLastUpdated(
            context,
            language,
            useFallbackFile,
        ) < Date().time - maxCacheAgeInMinutes * MINUTE_IN_MS
    }

    @VisibleForTesting
    internal fun getCacheLastUpdated(context: Context, language: String?, useFallbackFile: Boolean): Long {
        val file = getBaseCacheFile(context, language, useFallbackFile)
        return if (file.exists()) file.lastModified() else -1
    }

    private fun getCacheFile(context: Context, language: String?, useFallbackFile: Boolean): AtomicFile {
        return AtomicFile(getBaseCacheFile(context, language, useFallbackFile))
    }

    @VisibleForTesting
    internal fun getBaseCacheFile(context: Context, language: String?, useFallbackFile: Boolean): File {
        var file = File(context.filesDir, getCacheFileName(language))
        if (!file.exists() && useFallbackFile) {
            // In situations, where users change languages and we can't retrieve the new one,
            // we always want to fallback to the previous localized file.
            // Try to find first available localized file.
            val regex = Regex(REGEX_FILE_NAMES.format(getCollectionName()))
            val fallbackFile = context.filesDir.listFiles()?.find { it.name.matches(regex) }

            if (fallbackFile?.exists() == true) {
                file = fallbackFile
            }
        }
        return file
    }

    @VisibleForTesting
    internal fun getCacheFileName(language: String? = ""): String {
        val collection = getCollectionName()

        val fileName = if (language.isNullOrEmpty()) {
            COLLECTION_FILE_NAME.format(collection)
        } else {
            COLLECTION_FILE_NAME_WITH_LANGUAGE.format(language, collection)
        }
        return fileName.sanitizeFileName()
    }

    @VisibleForTesting
    internal fun getCollectionName(): String {
        val collectionUser = collectionUser.sanitizeFileName()
        val collectionName = collectionName.sanitizeFileName()

        // Prefix with collection user in case it was customized. We don't want
        // to do this for the default "mozilla" user so we don't break out of
        // the existing cache when we're introducing this. Plus mozilla is
        // already in the file name anyway.
        return if (collectionUser != DEFAULT_COLLECTION_USER) {
            "${collectionUser}_$collectionName"
        } else {
            collectionName
        }
    }
}

/**
 * Represents possible sort options for the recommended add-ons from
 * the configured add-on collection.
 */
enum class SortOption(val value: String) {
    POPULARITY("popularity"),
    POPULARITY_DESC("-popularity"),
    NAME("name"),
    NAME_DESC("-name"),
    DATE_ADDED("added"),
    DATE_ADDED_DESC("-added"),
}

internal fun JSONObject.getAddonsFromCollection(language: String? = null): List<Addon> {
    val addonsJson = getJSONArray("results")
    // Each result in a collection response has an `addon` key and some (optional) notes.
    return (0 until addonsJson.length()).map { index ->
        addonsJson.getJSONObject(index).getJSONObject("addon").toAddon(language)
    }
}

internal fun JSONObject.toAddon(language: String? = null): Addon {
    return with(this) {
        val safeLanguage = language?.lowercase(Locale.getDefault())
        val summary = getSafeTranslations("summary", safeLanguage)
        val isLanguageInTranslations = summary.containsKey(safeLanguage)
        Addon(
            id = getSafeString("guid"),
            author = getAuthor(),
            createdAt = getSafeString("created"),
            updatedAt = getCurrentVersionCreated(),
            downloadUrl = getDownloadUrl(),
            version = getCurrentVersion(),
            permissions = getPermissions(),
            translatableName = getSafeTranslations("name", safeLanguage),
            translatableDescription = getSafeTranslations("description", safeLanguage),
            translatableSummary = summary,
            iconUrl = getSafeString("icon_url"),
            // This isn't the add-on homepage but the URL to the AMO detail page. On AMO, the homepage is
            // a translatable field but https://github.com/mozilla/addons-server/issues/21310 prevents us
            // from retrieving the homepage URL of any add-on reliably.
            homepageUrl = getSafeString("url"),
            rating = getRating(),
            ratingUrl = getSafeString("ratings_url"),
            detailUrl = getSafeString("url"),
            defaultLocale = (
                if (!safeLanguage.isNullOrEmpty() && isLanguageInTranslations) {
                    safeLanguage
                } else {
                    getSafeString("default_locale").ifEmpty { Addon.DEFAULT_LOCALE }
                }
                ).lowercase(Locale.ROOT),
        )
    }
}

internal fun JSONObject.getRating(): Addon.Rating? {
    val jsonRating = optJSONObject("ratings")
    return if (jsonRating != null) {
        Addon.Rating(
            reviews = jsonRating.optInt("text_count"),
            average = jsonRating.optDouble("average").toFloat(),
        )
    } else {
        null
    }
}

internal fun JSONObject.getPermissions(): List<String> {
    val permissionsJson = getFile()?.getSafeJSONArray("permissions") ?: JSONArray()
    return (0 until permissionsJson.length()).map { index ->
        permissionsJson.getString(index)
    }
}

internal fun JSONObject.getCurrentVersion(): String {
    return getJSONObject("current_version").getSafeString("version")
}

internal fun JSONObject.getFile(): JSONObject? {
    return getJSONObject("current_version")
        .getSafeJSONArray("files")
        .optJSONObject(0)
}

internal fun JSONObject.getCurrentVersionCreated(): String {
    // We want to return: `current_version.files[0].created`.
    return getFile()?.getSafeString("created").orEmpty()
}

internal fun JSONObject.getDownloadUrl(): String {
    return getFile()?.getSafeString("url").orEmpty()
}

internal fun JSONObject.getAuthor(): Addon.Author? {
    val authorsJson = getSafeJSONArray("authors")
    // We only consider the first author in the AMO API response, mainly because Gecko does the same.
    val authorJson = authorsJson.optJSONObject(0)

    return if (authorJson != null) {
        Addon.Author(
            name = authorJson.getSafeString("name"),
            url = authorJson.getSafeString("url"),
        )
    } else {
        null
    }
}

internal fun JSONObject.getSafeString(key: String): String {
    return if (isNull(key)) {
        ""
    } else {
        getString(key)
    }
}

internal fun JSONObject.getSafeJSONArray(key: String): JSONArray {
    return if (isNull(key)) {
        JSONArray("[]")
    } else {
        getJSONArray(key)
    }
}

internal fun JSONObject.getSafeTranslations(valueKey: String, language: String?): Map<String, String> {
    // We can have two different versions of the JSON structure for translatable fields:
    // 1) A string with only one language, when we provide a language parameter.
    // 2) An object containing all the languages available when a language parameter is NOT present.
    // For this reason, we have to be specific about how we parse the JSON.
    return if (get(valueKey) is String) {
        val safeLanguage = (language ?: Addon.DEFAULT_LOCALE).lowercase(Locale.ROOT)
        mapOf(safeLanguage to getSafeString(valueKey))
    } else {
        getSafeMap(valueKey)
    }
}

internal fun JSONObject.getSafeMap(valueKey: String): Map<String, String> {
    return if (isNull(valueKey)) {
        emptyMap()
    } else {
        val map = mutableMapOf<String, String>()
        val jsonObject = getJSONObject(valueKey)

        jsonObject.keys()
            .forEach { key ->
                map[key.lowercase(Locale.ROOT)] = jsonObject.getSafeString(key)
            }
        map
    }
}
