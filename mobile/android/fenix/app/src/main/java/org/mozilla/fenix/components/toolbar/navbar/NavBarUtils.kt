/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.toolbar.navbar

import android.content.Context
import android.view.View
import android.view.ViewGroup
import mozilla.components.compose.base.theme.layout.AcornWindowSize
import org.mozilla.fenix.components.toolbar.ToolbarContainerView
import org.mozilla.fenix.components.toolbar.ToolbarPosition
import org.mozilla.fenix.ext.settings

/**
 *
 * Manages the state of the NavBar upon an orientation change.
 *
 * @param context [Context] needed for various Android interactions.
 * @param parent The top level [ViewGroup] of the fragment, which will be hosting toolbar/navbar container.
 * @param toolbarView [View] responsible for showing the AddressBar.
 * @param bottomToolbarContainerView The [ToolbarContainerView] hosting the NavBar.
 * @param reinitializeNavBar lambda for re-initializing the NavBar inside the host [Fragment].
 * @param reinitializeMicrosurveyPrompt lambda for re-initializing the microsurvey prompt inside the host [Fragment].
 */
fun updateNavBarForConfigurationChange(
    context: Context,
    parent: ViewGroup,
    toolbarView: View,
    bottomToolbarContainerView: ToolbarContainerView?,
    reinitializeNavBar: () -> Unit,
    reinitializeMicrosurveyPrompt: () -> Unit,
) {
    if (AcornWindowSize.getWindowSize(context).isNotSmall()) {
        // In landscape mode we want to remove the navigation bar.
        parent.removeView(bottomToolbarContainerView)

        // If address bar was positioned at bottom and we have removed the toolbar container, we are adding address bar
        // back.
        val isToolbarAtBottom = context.settings().toolbarPosition == ToolbarPosition.BOTTOM

        // Toolbar already having a parent is an edge case, but it could happen if configurationChange is called after
        // onCreateView with the same orientation. Caught it on a foldable emulator while going from single screen
        // portrait mode to landscape tablet, back and forth.
        val hasParent = toolbarView.parent != null
        if (isToolbarAtBottom && !hasParent) {
            parent.addView(toolbarView)
        }
        reinitializeMicrosurveyPrompt()
    } else {
        // Already having a bottomContainer after switching back to portrait mode will happen when address bar is
        // positioned at bottom and also as an edge case if configurationChange is called after onCreateView with the
        // same orientation. Caught it on a foldable emulator while going from single screen portrait mode to landscape
        // table, back and forth.
        bottomToolbarContainerView?.let {
            parent.removeView(it)
        }

        reinitializeNavBar()
    }
}
