/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.focus.telemetry

import mozilla.components.browser.state.action.BrowserAction
import mozilla.components.browser.state.action.ContentAction
import mozilla.components.browser.state.action.CustomTabListAction
import mozilla.components.browser.state.action.DownloadAction
import mozilla.components.browser.state.action.TabListAction
import mozilla.components.browser.state.selector.findTab
import mozilla.components.browser.state.state.BrowserState
import mozilla.components.browser.state.state.SessionState
import mozilla.components.browser.state.state.TabSessionState
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.concept.engine.window.WindowRequest
import mozilla.components.lib.state.Middleware
import mozilla.components.lib.state.MiddlewareContext
import mozilla.telemetry.glean.private.NoExtras
import org.mozilla.focus.GleanMetrics.AppOpened
import org.mozilla.focus.GleanMetrics.Browser
import org.mozilla.focus.GleanMetrics.Downloads
import org.mozilla.focus.GleanMetrics.TabCount
import kotlin.collections.forEach as withEach

class TelemetryMiddleware : Middleware<BrowserState, BrowserAction> {
    override fun invoke(
        context: MiddlewareContext<BrowserState, BrowserAction>,
        next: (BrowserAction) -> Unit,
        action: BrowserAction,
    ) {
        next(action)

        when (action) {
            is TabListAction.AddTabAction -> {
                collectTelemetry(action.tab, context)
            }
            is TabListAction.AddMultipleTabsAction -> action.tabs.withEach {
                collectTelemetry(it, context)
            }

            is CustomTabListAction.TurnCustomTabIntoNormalTabAction -> {
                TabCount.newTabOpened.record(
                    TabCount.NewTabOpenedExtra(context.state.tabs.size, "custom tab"),
                )
            }

            is ContentAction.UpdateLoadingStateAction -> {
                context.state.findTab(action.sessionId)?.let { tab ->
                    // Record UriOpened event when a page finishes loading
                    if (tab.content.loading || action.loading) {
                        // tab is still loading
                    } else {
                        Browser.totalUriCount.add()
                    }
                }
            }
            is DownloadAction.AddDownloadAction -> {
                Downloads.downloadStarted.record(NoExtras())
            }
            is DownloadAction.UpdateDownloadAction -> {
                if (action.download.status == DownloadState.Status.CANCELLED) {
                    Downloads.downloadCanceled.record(NoExtras())
                }
            }
            else -> {
                // no-op
            }
        }
    }

    private fun collectTelemetry(
        tab: SessionState,
        context: MiddlewareContext<BrowserState, BrowserAction>,
    ) {
        val tabCount = context.state.tabs.size

        when (tab.source) {
            is SessionState.Source.External.ActionView -> {
                AppOpened.browseIntent.record(NoExtras())
            }
            is SessionState.Source.External.ActionSend -> {
                AppOpened.shareIntent.record(
                    AppOpened.ShareIntentExtra(tab.content.searchTerms.isNotEmpty()),
                )
            }
            SessionState.Source.Internal.TextSelection -> {
                AppOpened.textSelectionIntent.record(NoExtras())
            }
            SessionState.Source.Internal.HomeScreen -> {
                AppOpened.fromLauncherSiteShortcut.record(NoExtras())
            }
            SessionState.Source.Internal.NewTab -> {
                val parentTab = (tab as TabSessionState).parentId?.let { context.state.findTab(it) }
                if (parentTab?.content?.windowRequest?.type == WindowRequest.Type.OPEN) {
                    TabCount.newTabOpened.record(
                        TabCount.NewTabOpenedExtra(tabCount, "Window.open()"),
                    )
                } else {
                    TabCount.newTabOpened.record(
                        TabCount.NewTabOpenedExtra(tabCount, "context menu"),
                    )
                }
            }

            else -> {
                // For other session types we create events at the place where we create the sessions.
            }
        }
    }
}
