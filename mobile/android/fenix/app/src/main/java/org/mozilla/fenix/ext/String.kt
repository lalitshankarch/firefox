/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ext

import android.text.Editable
import androidx.compose.runtime.Composable
import mozilla.components.compose.base.utils.inComposePreview
import mozilla.components.support.base.utils.MAX_URI_LENGTH
import mozilla.components.support.ktx.kotlin.toShortUrl
import mozilla.components.support.ktx.kotlin.tryGetHostFromUrl
import org.mozilla.fenix.components.components

/**
 * Shortens URLs to be more user friendly, by applying [String.toShortUrl]
 * and making sure it's equal or below the [MAX_URI_LENGTH].
 */
@Composable
fun String.toShortUrl(): String {
    // Truncate to MAX_URI_LENGTH to prevent the UI from locking up for
    // extremely large URLs such as data URIs or bookmarklets. The same
    // is done in the toolbar and awesomebar:
    // https://github.com/mozilla-mobile/fenix/issues/1824
    // https://github.com/mozilla-mobile/android-components/issues/6985
    return if (inComposePreview) {
        this.take(MAX_URI_LENGTH)
    } else {
        this.toShortUrl(components.publicSuffixList)
            .take(MAX_URI_LENGTH)
    }
}

/**
 * Trims a URL string of its scheme and common prefixes.
 *
 * This is intended to act much like [PublicSuffixList.getPublicSuffixPlusOne()] but unlike
 * that method, leaves the path, anchor, etc intact.
 *
 */
fun String.simplifiedUrl(): String {
    val afterScheme = this.substringAfter("://")
    for (prefix in listOf("www.", "m.", "mobile.")) {
        if (afterScheme.startsWith(prefix)) {
            return afterScheme.substring(prefix.length)
        }
    }
    return afterScheme
}

/**
 * Returns an [Editable] for the provided string.
 */
fun String.toEditable(): Editable = Editable.Factory.getInstance().newEditable(this)

/**
 * Returns a Ipv6 address with consecutive sections of zeroes replaced with a double colon.
 */
fun String?.replaceConsecutiveZeros(): String? =
    this?.replaceFirst(":0", ":")?.replace(":0", "")

/**
 * Extracts a shortened or simplified URL from a given URL string.
 * (e.g., "example.com" instead of "https://www.example.com/long/path/to/file")
 *
 * This function handles both regular URLs and blob URLs. For regular URLs, it extracts the base domain.
 * For blob URLs, it extracts the base domain from the URL embedded within the blob URL.
 *
 * @receiver The URL string to extract the shortened URL from.
 * @return The shortened URL (typically the base domain).
 */
fun String.getBaseDomainUrl(): String {
    return when {
        this.startsWith("blob:") -> {
            val blobUrl = this.substringAfter("blob:")
            blobUrl.tryGetHostFromUrl().getBaseDomainFromHost()
        }

        else -> this.tryGetHostFromUrl().getBaseDomainFromHost()
    }
}

private fun String.getBaseDomainFromHost(): String {
    val parts = this.split(".")
    return if (parts.size >= 2) {
        parts.takeLast(2).joinToString(".")
    } else {
        this
    }
}
