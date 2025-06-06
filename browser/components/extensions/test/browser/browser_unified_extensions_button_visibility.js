/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

loadTestSubscript("head_unified_extensions.js");

const PREF_ALWAYS_VISIBLE =
  "extensions.unifiedExtensions.button.always_visible";

function showButtonWithPref() {
  info(`showButtonWithPref: Setting ${PREF_ALWAYS_VISIBLE} to true`);
  Services.prefs.setBoolPref(PREF_ALWAYS_VISIBLE, true);
}

function hideButtonWithPref() {
  info(`hideButtonWithPref: Setting ${PREF_ALWAYS_VISIBLE} to false`);
  Services.prefs.setBoolPref(PREF_ALWAYS_VISIBLE, false);
}

function resetButtonVisibilityToDefault() {
  Services.prefs.clearUserPref(PREF_ALWAYS_VISIBLE);
}

async function checkAndDismissPostHideNotification(win) {
  // After hiding the extensions button, a notification is displayed for 3
  // seconds, notifying the user of "Move to menu". Check that it is shown and
  // dismiss the notification.
  info("Verifying that the 'Moved to menu' hint is shown");
  let hintElem = win.ConfirmationHint._panel;
  if (hintElem.state !== "open") {
    info("Waiting for hint to be shown");
    await BrowserTestUtils.waitForEvent(hintElem, "popupshown");
  }
  is(hintElem.state, "open", "Hint popup is open");
  is(hintElem.anchorNode.id, "PanelUI-menu-button", "Anchored to appmenu");
  is(
    win.ConfirmationHint._message.getAttribute("data-l10n-id"),
    "confirmation-hint-extensions-button-hidden",
    "Shown 'Moved to menu' notification"
  );
  let hiddenpromise = BrowserTestUtils.waitForEvent(hintElem, "popuphidden");
  hintElem.hidePopup();
  info("Waiting for hint to be dismissed");
  await hiddenpromise;
}

// Tests in this file repeatedly flips prefs. To avoid having to balance
// pushPrefEnv / popPrefEnv often, reset it once in the end.
registerCleanupFunction(resetButtonVisibilityToDefault);

add_task(async function test_default_button_visibility() {
  assertExtensionsButtonVisible();
});

add_task(async function test_hide_button_before_new_window() {
  hideButtonWithPref();
  const win = await BrowserTestUtils.openNewBrowserWindow();
  assertExtensionsButtonHidden(win);

  showButtonWithPref();
  assertExtensionsButtonVisible(win);

  await BrowserTestUtils.closeWindow(win);
  resetButtonVisibilityToDefault();
});

add_task(async function test_show_button_before_new_window() {
  showButtonWithPref();
  const win = await BrowserTestUtils.openNewBrowserWindow();
  assertExtensionsButtonVisible(win);

  hideButtonWithPref();
  assertExtensionsButtonHidden(win);

  await BrowserTestUtils.closeWindow(win);
  resetButtonVisibilityToDefault();
});

// Until the "Hide Extensions Button" feature finished its implementation, the
// UI to trigger hiding should be disabled by default.
add_task(async function test_remove_from_toolbar_disabled_by_default() {
  const contextMenu = await openChromeContextMenu(
    "toolbar-context-menu",
    "#unified-extensions-button"
  );
  const removeFromToolbar = contextMenu.querySelector(
    ".customize-context-removeFromToolbar"
  );
  ok(removeFromToolbar.hasAttribute("disabled"), "removeFromToolbar disabled");
  await closeChromeContextMenu(contextMenu.id, null);
});

add_task(async function test_hide_button_via_contextmenu() {
  await SpecialPowers.pushPrefEnv({
    set: [["extensions.unifiedExtensions.button.customizable", true]],
  });
  // Open another window, just to see that removal from the toolbar in one
  // window also applies to another.
  const win = await BrowserTestUtils.openNewBrowserWindow();

  const contextMenu = await openChromeContextMenu(
    "toolbar-context-menu",
    "#unified-extensions-button",
    win
  );
  const removeFromToolbar = contextMenu.querySelector(
    ".customize-context-removeFromToolbar"
  );
  is(removeFromToolbar.hidden, false, "removeFromToolbar is visible");
  ok(!removeFromToolbar.hasAttribute("disabled"), "removeFromToolbar enabled");

  await closeChromeContextMenu(contextMenu.id, removeFromToolbar, win);

  info("Extensions button should hide after choosing 'Remove from Toolbar'");
  assertExtensionsButtonHidden(win);

  info("Extensions button should also be hidden in another window");
  assertExtensionsButtonHidden(window);

  await checkAndDismissPostHideNotification(win);

  await BrowserTestUtils.closeWindow(win);
  resetButtonVisibilityToDefault();
  await SpecialPowers.popPrefEnv();
});

// Despite the button being hidden by pref, there are ways for the button to
// still show up. This checks whether the menu items appear as expected, and
// that the user can reveal the button again.
add_task(async function test_menu_items_on_hidden_button() {
  await SpecialPowers.pushPrefEnv({
    set: [["extensions.unifiedExtensions.button.customizable", true]],
  });

  hideButtonWithPref();

  // Simulate the extensions button being unhidden for whatever reason.
  gUnifiedExtensions.button.hidden = false;
  const contextMenu = await openChromeContextMenu(
    "toolbar-context-menu",
    "#unified-extensions-button"
  );
  gUnifiedExtensions.button.hidden = true;
  assertExtensionsButtonHidden();

  const removeFromToolbar = contextMenu.querySelector(
    ".customize-context-removeFromToolbar"
  );
  is(removeFromToolbar.hidden, true, "removeFromToolbar is hidden");
  ok(removeFromToolbar.hasAttribute("disabled"), "removeFromToolbar disabled");

  const item = contextMenu.querySelector(
    "#toolbar-context-always-show-extensions-button"
  );
  is(item.hidden, false, "'Always Show in Toolbar' menu item shown");
  ok(!item.hasAttribute("checked"), "Should be unchecked to reflect pref");

  await closeChromeContextMenu(contextMenu.id, item);
  assertExtensionsButtonVisible();

  // After unhiding the button, the menu items should be the defaults:
  // - removeFromToolbar: from disabled to enabled.
  // - 'Always Show in Toolbar': from visible to hidden.
  info("Checking context menu after unhiding the button");
  const contextMenu2 = await openChromeContextMenu(
    "toolbar-context-menu",
    "#unified-extensions-button"
  );
  is(contextMenu, contextMenu2, "Context menu is the same");
  is(removeFromToolbar.hidden, false, "removeFromToolbar is visible");
  ok(!removeFromToolbar.hasAttribute("disabled"), "removeFromToolbar enabled");
  is(item.hidden, true, "'Always Show in Toolbar' menu item is hidden");

  await closeChromeContextMenu(contextMenu2.id);

  resetButtonVisibilityToDefault();
  await SpecialPowers.popPrefEnv();
});

// Until the the "Hide Extensions Button" feature finished its implementation,
// the UI to trigger hiding should be disabled by default.
add_task(async function test_customization_disabled_by_default() {
  await openCustomizationUI();
  const contextMenu = await openChromeContextMenu(
    "toolbar-context-menu",
    "#wrapper-unified-extensions-button"
  );
  const item = document.getElementById(
    "toolbar-context-always-show-extensions-button"
  );
  is(item.hidden, true, "Not expecting menu item to hide button");
  await closeChromeContextMenu(contextMenu.id);
  await closeCustomizationUI();
});

add_task(async function test_customization_option_hidden_if_not_customizing() {
  await SpecialPowers.pushPrefEnv({
    set: [["extensions.unifiedExtensions.button.customizable", true]],
  });
  const contextMenu = await openChromeContextMenu(
    "toolbar-context-menu",
    "#unified-extensions-button"
  );
  const item = document.getElementById(
    "toolbar-context-always-show-extensions-button"
  );
  is(item.hidden, true, "Not expecting menu item to hide button");
  await closeChromeContextMenu(contextMenu.id);
  await SpecialPowers.popPrefEnv();
});

// Tests that the "Always Show in Toolbar" checkbox is visible in the menu and
// reflects the expected state when entering/exiting customization mode.
// And that the Extensions Button is always shown while in customization mode.
add_task(async function test_customization_button_and_menu_item_visibility() {
  await SpecialPowers.pushPrefEnv({
    set: [["extensions.unifiedExtensions.button.customizable", true]],
  });

  const win = await BrowserTestUtils.openNewBrowserWindow();

  await openCustomizationUI(win);
  {
    info("Toggle checkbox via context menu, from on to off");
    const contextMenu = await openChromeContextMenu(
      "toolbar-context-menu",
      "#wrapper-unified-extensions-button",
      win
    );
    const item = win.document.getElementById(
      "toolbar-context-always-show-extensions-button"
    );
    is(item.hidden, false, "Menu item should be visible");
    is(item.getAttribute("checked"), "true", "Should be checked by default");
    await closeChromeContextMenu(contextMenu.id, item, win);

    info("The button should still be visible while customizing");
    assertExtensionsButtonVisible(win);
    info("The button should be hidden in windows that are not customizing");
    assertExtensionsButtonHidden();

    await checkAndDismissPostHideNotification(win);
  }

  {
    info("Open context menu to verify checked state, then cancel menu");
    const contextMenu = await openChromeContextMenu(
      "toolbar-context-menu",
      "#wrapper-unified-extensions-button",
      win
    );
    const item = win.document.getElementById(
      "toolbar-context-always-show-extensions-button"
    );
    is(item.hidden, false, "Menu item should be visible");
    ok(!item.getAttribute("checked"), "Should be unchecked by earlier action");
    await closeChromeContextMenu(contextMenu.id, null, win);
  }

  await closeCustomizationUI(win);
  info("The button should be hidden after exiting customization");
  assertExtensionsButtonHidden(win);

  await openCustomizationUI(win);
  info("The button should be visible upon entering customization");
  assertExtensionsButtonVisible(win);
  {
    info("Toggle checkbox via context menu, from off to on");
    const contextMenu = await openChromeContextMenu(
      "toolbar-context-menu",
      "#wrapper-unified-extensions-button",
      win
    );
    const item = win.document.getElementById(
      "toolbar-context-always-show-extensions-button"
    );
    is(item.hidden, false, "Menu item should be visible");
    ok(!item.hasAttribute("checked"), "Should be unchecked");
    await closeChromeContextMenu(contextMenu.id, item, win);

    info("After checking the option, buttons should be shown in all windows");
    assertExtensionsButtonVisible(win);
    assertExtensionsButtonVisible();
  }

  await closeCustomizationUI(win);
  await BrowserTestUtils.closeWindow(win);

  resetButtonVisibilityToDefault();
  await SpecialPowers.popPrefEnv();
});
