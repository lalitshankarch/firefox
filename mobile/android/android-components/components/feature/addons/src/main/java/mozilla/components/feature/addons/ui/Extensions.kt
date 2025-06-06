/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.addons.ui

import android.content.Context
import android.widget.ImageView
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toDrawable
import mozilla.components.feature.addons.Addon
import mozilla.components.feature.addons.R
import mozilla.components.feature.addons.update.AddonUpdater
import mozilla.components.feature.addons.update.AddonUpdater.Status.Error
import mozilla.components.feature.addons.update.AddonUpdater.Status.NoUpdateAvailable
import mozilla.components.feature.addons.update.AddonUpdater.Status.SuccessfullyUpdated
import mozilla.components.support.ktx.android.content.res.resolveAttribute
import mozilla.components.ui.widgets.withCenterAlignedButtons
import java.text.DateFormat
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Used to parse [Addon.createdAt] and [Addon.updatedAt].
 */
private val dateParser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply {
    timeZone = TimeZone.getTimeZone("GMT")
}

/**
 * A shortcut to get the localized name of an add-on.
 */
fun Addon.translateName(context: Context): String = translatableName.translate(this, context)

/**
 * A short to get the display name of an add-on.
 */
fun Addon.displayName(context: Context): String = if (this.translatableName.isNotEmpty()) {
    this.translateName(context)
} else {
    this.id
}

/**
 * A shortcut to get the localized summary of an add-on.
 */
fun Addon.translateSummary(context: Context): String = translatableSummary.translate(this, context)

/**
 * A shortcut to get the display summary of an add-on.
 */
fun Addon.summary(context: Context): String? = if (this.translatableSummary.isNotEmpty()) {
    this.translateSummary(context)
} else {
    null
}

/**
 * A shortcut to get the localized description of an add-on.
 */
fun Addon.translateDescription(context: Context): String = translatableDescription.translate(this, context)

/**
 * The date the add-on was created, as a JVM date object.
 */
val Addon.createdAtDate: Date get() =
    // This method never returns null and will throw a ParseException if parsing fails
    dateParser.parse(createdAt)!!

/**
 * The date of the last time the add-on was updated by its developer(s),
 * as a JVM date object.
 */
val Addon.updatedAtDate: Date get() = dateParser.parse(updatedAt)!!

/**
 * Try to find the default language on the map otherwise defaults to [Addon.DEFAULT_LOCALE].
 */
internal fun Map<String, String>.translate(addon: Addon, context: Context): String {
    val lang = Locale.getDefault().language
    val safeLang = if (!lang.isNullOrEmpty()) lang.lowercase(Locale.getDefault()) else lang
    return get(safeLang) ?: getOrElse(addon.defaultLocale) {
        context.getString(R.string.mozac_feature_addons_failed_to_translate, lang, addon.defaultLocale)
    }
}

/**
 * Get the formatted number amount for the current default locale.
 */
internal fun getFormattedAmount(amount: Int): String {
    return NumberFormat.getNumberInstance(Locale.getDefault()).format(amount)
}

/**
 * Get the localized string for an [AddonUpdater.UpdateAttempt.status].
 */
fun AddonUpdater.Status?.toLocalizedString(context: Context): String {
    return when (this) {
        SuccessfullyUpdated -> {
            context.getString(R.string.mozac_feature_addons_updater_status_successfully_updated)
        }
        NoUpdateAvailable -> {
            context.getString(R.string.mozac_feature_addons_updater_status_no_update_available)
        }
        is Error -> {
            val errorLabel = context.getString(R.string.mozac_feature_addons_updater_status_error)
            "$errorLabel $exception"
        }
        else -> ""
    }
}

/**
 * Shows a dialog containing all the information related to the given [AddonUpdater.UpdateAttempt].
 */
fun AddonUpdater.UpdateAttempt.showInformationDialog(context: Context) {
    AlertDialog.Builder(context)
        .setTitle(R.string.mozac_feature_addons_updater_dialog_title)
        .setMessage(getDialogMessage(context))
        .show()
        .withCenterAlignedButtons()
}

private fun AddonUpdater.UpdateAttempt.getDialogMessage(context: Context): String {
    val statusString = status.toLocalizedString(context)
    val dateString = DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.LONG).format(date)
    val lastAttemptLabel = context.getString(R.string.mozac_feature_addons_updater_dialog_last_attempt)
    val statusLabel = context.getString(R.string.mozac_feature_addons_updater_dialog_status)
    return "$lastAttemptLabel $dateString \n $statusLabel $statusString ".trimMargin()
}

/**
 * Set icon to this [ImageView] with from the provided [Addon]'s icon.
 */
fun ImageView.setIcon(addon: Addon) {
    val icon = addon.provideIcon()
    if (icon != null) {
        setImageDrawable(icon.toDrawable(resources))
    } else {
        setDefaultAddonIcon()
    }
}

/**
 * Set the default addon's icon to this [ImageView].
 */
fun ImageView.setDefaultAddonIcon() {
    val safeContext = context ?: return
    val att = safeContext.theme.resolveAttribute(android.R.attr.textColorPrimary)
    setColorFilter(ContextCompat.getColor(safeContext, att))
    setImageDrawable(
        ContextCompat.getDrawable(
            safeContext,
            mozilla.components.ui.icons.R.drawable.mozac_ic_extension_24,
        ),
    )
}
