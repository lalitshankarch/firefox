/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env mozilla/remote-page */

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { html, ifDefined } from "chrome://global/content/vendor/lit.all.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/highlights.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/settings.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/adjusted-rating.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/reliability.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/analysis-explainer.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/shopping-message-bar.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/unanalyzed.mjs";
// eslint-disable-next-line import/no-unassigned-import
import "chrome://browser/content/shopping/recommended-ad.mjs";

// The number of pixels that must be scrolled from the
// top of the sidebar to show the header box shadow.
const HEADER_SCROLL_PIXEL_OFFSET = 8;

const HEADER_NOT_TEXT_WRAPPED_HEIGHT = 32;
const SIDEBAR_CLOSED_COUNT_PREF =
  "browser.shopping.experience2023.sidebarClosedCount";
const SHOW_KEEP_SIDEBAR_CLOSED_MESSAGE_PREF =
  "browser.shopping.experience2023.showKeepSidebarClosedMessage";
const SHOPPING_SIDEBAR_ACTIVE_PREF = "browser.shopping.experience2023.active";

const CLOSED_COUNT_PREVIOUS_MIN = 4;
const CLOSED_COUNT_PREVIOUS_MAX = 6;

export class ShoppingContainer extends MozLitElement {
  static properties = {
    data: { type: Object },
    showOnboarding: { type: Boolean },
    productUrl: { type: String },
    recommendationData: { type: Array },
    isOffline: { type: Boolean },
    analysisEvent: { type: Object },
    userReportedAvailable: { type: Boolean },
    adsEnabled: { type: Boolean },
    adsEnabledByUser: { type: Boolean },
    isAnalysisInProgress: { type: Boolean },
    analysisProgress: { type: Number },
    showHeaderShadow: { type: Boolean, state: true },
    isOverflow: { type: Boolean },
    autoOpenEnabled: { type: Boolean },
    autoOpenEnabledByUser: { type: Boolean },
    showingKeepClosedMessage: { type: Boolean },
    isHeaderOverflow: { type: Boolean, state: true },
  };

  static get queries() {
    return {
      reviewReliabilityEl: "review-reliability",
      adjustedRatingEl: "adjusted-rating",
      highlightsEl: "review-highlights",
      settingsEl: "shopping-settings",
      analysisExplainerEl: "analysis-explainer",
      unanalyzedProductEl: "unanalyzed-product-card",
      shoppingMessageBarEl: "shopping-message-bar",
      recommendedAdEl: "recommended-ad",
      loadingEl: "#loading-wrapper",
      closeButtonEl: "#close-button",
      keepClosedMessageBarEl: "#keep-closed-message-bar",
      containerContentEl: "#content",
      header: "#shopping-header",
    };
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    window.document.addEventListener("Update", this);
    window.document.addEventListener("NewAnalysisRequested", this);
    window.document.addEventListener("ReanalysisRequested", this);
    window.document.addEventListener("ReportedProductAvailable", this);
    window.document.addEventListener("adsEnabledByUserChanged", this);
    window.document.addEventListener("scroll", this);
    window.document.addEventListener("UpdateRecommendations", this);
    window.document.addEventListener("UpdateAnalysisProgress", this);
    window.document.addEventListener("autoOpenEnabledByUserChanged", this);
    window.document.addEventListener("ShowKeepClosedMessage", this);
    window.document.addEventListener("HideKeepClosedMessage", this);

    window.dispatchEvent(
      new CustomEvent("ContentReady", {
        bubbles: true,
        composed: true,
      })
    );
  }

  disconnectedCallback() {
    this.headerResizeObserver?.disconnect();
  }

  firstUpdated() {
    this.headerResizeObserver = new ResizeObserver(([entry]) =>
      this.maybeSetIsHeaderOverflow(entry)
    );
    this.headerResizeObserver.observe(this.header);
  }

  updated() {
    if (this.focusCloseButton) {
      this.closeButtonEl.focus();
    }
  }

  async _update({
    data,
    showOnboarding,
    productUrl,
    recommendationData,
    adsEnabled,
    adsEnabledByUser,
    isAnalysisInProgress,
    analysisProgress,
    focusCloseButton,
    autoOpenEnabled,
    autoOpenEnabledByUser,
  }) {
    // If we're not opted in or there's no shopping URL in the main browser,
    // the actor will pass `null`, which means this will clear out any existing
    // content in the sidebar.
    this.data = data;
    this.showOnboarding = showOnboarding ?? this.showOnboarding;
    this.productUrl = productUrl;
    this.recommendationData = recommendationData;
    this.isOffline = !navigator.onLine;
    this.isAnalysisInProgress = isAnalysisInProgress;
    this.adsEnabled = adsEnabled ?? this.adsEnabled;
    this.adsEnabledByUser = adsEnabledByUser ?? this.adsEnabledByUser;
    this.analysisProgress = analysisProgress;
    this.focusCloseButton = focusCloseButton;
    this.autoOpenEnabled = autoOpenEnabled ?? this.autoOpenEnabled;
    this.autoOpenEnabledByUser =
      autoOpenEnabledByUser ?? this.autoOpenEnabledByUser;
  }

  _updateRecommendations({ recommendationData }) {
    this.recommendationData = recommendationData;
  }

  _updateAnalysisProgress({ progress }) {
    this.analysisProgress = progress;
  }

  handleEvent(event) {
    switch (event.type) {
      case "Update":
        this._update(event.detail);
        break;
      case "NewAnalysisRequested":
      case "ReanalysisRequested":
        this.isAnalysisInProgress = true;
        this.analysisEvent = {
          type: event.type,
          productUrl: this.productUrl,
        };
        window.dispatchEvent(
          new CustomEvent("PolledRequestMade", {
            bubbles: true,
            composed: true,
          })
        );
        break;
      case "ReportedProductAvailable":
        this.userReportedAvailable = true;
        window.dispatchEvent(
          new CustomEvent("ReportProductAvailable", {
            bubbles: true,
            composed: true,
          })
        );
        Glean.shopping.surfaceReactivatedButtonClicked.record();
        break;
      case "adsEnabledByUserChanged":
        this.adsEnabledByUser = event.detail?.adsEnabledByUser;
        break;
      case "scroll":
        this.showHeaderShadow = window.scrollY > HEADER_SCROLL_PIXEL_OFFSET;
        break;
      case "UpdateRecommendations":
        this._updateRecommendations(event.detail);
        break;
      case "UpdateAnalysisProgress":
        this._updateAnalysisProgress(event.detail);
        break;
      case "autoOpenEnabledByUserChanged":
        this.autoOpenEnabledByUser = event.detail?.autoOpenEnabledByUser;
        break;
      case "ShowKeepClosedMessage":
        this.showingKeepClosedMessage = true;
        break;
      case "HideKeepClosedMessage":
        this.showingKeepClosedMessage = false;
        break;
    }
  }

  maybeSetIsHeaderOverflow(entry) {
    let isOverflow = entry.contentRect.height > HEADER_NOT_TEXT_WRAPPED_HEIGHT;
    if (this.isHeaderOverflow != isOverflow) {
      this.isHeaderOverflow = isOverflow;
    }
  }

  getHostnameFromProductUrl() {
    let hostname = URL.parse(this.productUrl)?.hostname;
    if (hostname) {
      return hostname;
    }
    console.warn(`Unknown product url ${this.productUrl}.`);
    return null;
  }

  analysisDetailsTemplate() {
    /* At present, en is supported as the default language for reviews. As we support more sites,
     * update `lang` accordingly if highlights need to be displayed in other languages. */
    let hostname = this.getHostnameFromProductUrl();

    let lang = "en";
    let isDEFRSupported = RPMGetBoolPref(
      "toolkit.shopping.experience2023.defr",
      false
    );

    if (isDEFRSupported && hostname === "www.amazon.fr") {
      lang = "fr";
    } else if (isDEFRSupported && hostname === "www.amazon.de") {
      lang = "de";
    }

    return html`
      <review-reliability letter=${this.data.grade}></review-reliability>
      <adjusted-rating
        rating=${ifDefined(this.data.adjusted_rating)}
      ></adjusted-rating>
      <review-highlights
        .highlights=${this.data.highlights}
        lang=${lang}
      ></review-highlights>
    `;
  }

  hasDataTemplate() {
    let dataBodyTemplate = null;

    // The user requested an analysis which is not done yet.
    if (
      this.analysisEvent?.productUrl == this.productUrl &&
      this.isAnalysisInProgress
    ) {
      const isReanalysis = this.analysisEvent.type === "ReanalysisRequested";
      dataBodyTemplate = html`<shopping-message-bar
          type=${isReanalysis
            ? "reanalysis-in-progress"
            : "analysis-in-progress"}
          progress=${this.analysisProgress}
        ></shopping-message-bar>
        ${isReanalysis ? this.analysisDetailsTemplate() : null}`;
    } else if (this.data?.error) {
      dataBodyTemplate = html`<shopping-message-bar
        type="generic-error"
      ></shopping-message-bar>`;
    } else if (this.data.page_not_supported) {
      dataBodyTemplate = html`<shopping-message-bar
        type="page-not-supported"
      ></shopping-message-bar>`;
    } else if (this.data.deleted_product_reported) {
      dataBodyTemplate = html`<shopping-message-bar
        type="product-not-available-reported"
      ></shopping-message-bar>`;
    } else if (this.data.deleted_product) {
      dataBodyTemplate = this.userReportedAvailable
        ? html`<shopping-message-bar
            type="thanks-for-reporting"
          ></shopping-message-bar>`
        : html`<shopping-message-bar
            type="product-not-available"
          ></shopping-message-bar>`;
    } else if (this.data.needs_analysis) {
      if (!this.data.product_id || typeof this.data.grade != "string") {
        // Product is new to us.
        dataBodyTemplate = html`<unanalyzed-product-card
          productUrl=${ifDefined(this.productUrl)}
        ></unanalyzed-product-card>`;
      } else {
        // We successfully analyzed the product before, but the current analysis is outdated and can be updated
        // via a re-analysis.
        dataBodyTemplate = html`
          <shopping-message-bar
            type="stale"
            .productUrl=${this.productUrl}
          ></shopping-message-bar>
          ${this.analysisDetailsTemplate()}
        `;
      }
    } else if (this.data.not_enough_reviews) {
      // We already saw and tried to analyze this product before, but there are not enough reviews
      // to make a detailed analysis.
      dataBodyTemplate = html`<shopping-message-bar
        type="not-enough-reviews"
      ></shopping-message-bar>`;
    } else {
      dataBodyTemplate = this.analysisDetailsTemplate();
    }

    return html`
      ${dataBodyTemplate}${this.explainerTemplate()}${this.recommendationTemplate()}
    `;
  }

  recommendationTemplate() {
    const canShowAds = this.adsEnabled && this.adsEnabledByUser;
    if (this.recommendationData?.length && canShowAds) {
      return html`<recommended-ad
        .product=${this.recommendationData[0]}
      ></recommended-ad>`;
    }
    return null;
  }

  /**
   * @param {object?} options
   * @param {boolean?} options.animate = true
   *        Whether to animate the loading state. Defaults to true.
   *        There will be no animation for users who prefer reduced motion,
   *        irrespective of the value of this option.
   */
  loadingTemplate({ animate = true } = {}) {
    /* Due to limitations with aria-busy for certain screen readers
     * (see Bug 1682063), mark loading container as a pseudo image and
     * use aria-label as a workaround. */
    return html`
      <div
        id="loading-wrapper"
        data-l10n-id="shopping-a11y-loading"
        role="img"
        class=${animate ? "animate" : ""}
      >
        <div class="loading-box medium"></div>
        <div class="loading-box medium"></div>
        <div class="loading-box large"></div>
        <div class="loading-box small"></div>
        <div class="loading-box large"></div>
        <div class="loading-box small"></div>
      </div>
    `;
  }

  noDataTemplate({ animate = true } = {}) {
    if (this.isAnalysisInProgress) {
      return html`<shopping-message-bar
          type="analysis-in-progress"
          progress=${this.analysisProgress}
        ></shopping-message-bar
        >${this.explainerTemplate()}${this.recommendationTemplate()}`;
    }
    return this.loadingTemplate({ animate });
  }

  headerTemplate() {
    const headerWrapperClasses = `${this.showHeaderShadow ? "header-wrapper-shadow" : ""} ${this.isHeaderOverflow ? "header-wrapper-overflow" : ""}`;
    return html`<div id="header-wrapper" class=${headerWrapperClasses}>
      <header id="shopping-header" data-l10n-id="shopping-a11y-header">
        <h1
          id="shopping-header-title"
          data-l10n-id="shopping-main-container-title"
        ></h1>
        <p id="beta-marker" data-l10n-id="shopping-beta-marker"></p>
      </header>
      <button
        id="close-button"
        class="ghost-button shopping-button"
        data-l10n-id="shopping-close-button"
        @click=${this.handleCloseButtonClick}
      ></button>
    </div>`;
  }

  // TODO: (Bug 1949647) do not render "Keep closed" message and notification card simultaneously.
  renderContainer(sidebarContent, { showSettings = false } = {}) {
    return html`<link
        rel="stylesheet"
        href="chrome://browser/content/shopping/shopping-container.css"
      />
      <link
        rel="stylesheet"
        href="chrome://global/skin/in-content/common.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/shopping/shopping-page.css"
      />
      <div id="shopping-container">
        ${this.headerTemplate()}
        <div id="content" aria-live="polite" aria-busy=${!this.data}>
          <slot name="multi-stage-message-slot"></slot>
          ${this.userInteractionMessageTemplate()}${sidebarContent}
          ${showSettings
            ? this.settingsTemplate({ className: "first-footer-card" })
            : null}
        </div>
      </div>`;
  }

  explainerTemplate({ className = "" } = {}) {
    return html`<analysis-explainer
      productUrl=${ifDefined(this.productUrl)}
      class=${className}
    ></analysis-explainer>`;
  }

  settingsTemplate({ className = "" } = {}) {
    let hostname = this.getHostnameFromProductUrl();
    return html` <shopping-settings
      ?adsEnabled=${this.adsEnabled}
      ?adsEnabledByUser=${this.adsEnabledByUser}
      ?autoOpenEnabled=${this.autoOpenEnabled}
      ?autoOpenEnabledByUser=${this.autoOpenEnabledByUser}
      .hostname=${hostname}
      class=${className}
    ></shopping-settings>`;
  }

  userInteractionMessageTemplate() {
    if (!this.autoOpenEnabled || !this.autoOpenEnabledByUser) {
      return null;
    }

    if (this.showingKeepClosedMessage) {
      return this.keepClosedMessageTemplate();
    }

    return null;
  }

  keepClosedMessageTemplate() {
    return html`<shopping-message-bar
      id="keep-closed-message-bar"
      type="keep-closed"
    ></shopping-message-bar>`;
  }

  render() {
    let content;
    // this.data may be null because we're viewing a non PDP, or a PDP that does not have data yet.
    const isLoadingData = !this.data;

    if (this.showOnboarding) {
      content = html``;
    } else if (isLoadingData || this.isOffline) {
      content = this.noDataTemplate({ animate: !this.isOffline });
    } else {
      content = this.hasDataTemplate();
    }

    const showSettings =
      !this.showOnboarding &&
      !this.isOffline &&
      (!isLoadingData || (isLoadingData && this.isAnalysisInProgress));
    return this.renderContainer(content, { showSettings });
  }

  handleCloseButtonClick() {
    let canShowKeepClosedMessage;

    if (this.autoOpenEnabled && this.autoOpenEnabledByUser) {
      canShowKeepClosedMessage =
        this._canShowKeepClosedMessageOnCloseButtonClick();
    }

    if (!canShowKeepClosedMessage) {
      RPMSetPref(SHOPPING_SIDEBAR_ACTIVE_PREF, false);
      window.dispatchEvent(
        new CustomEvent("CloseShoppingSidebar", {
          bubbles: true,
          composed: true,
        })
      );
    }

    Glean.shopping.surfaceClosed.record({ source: "closeButton" });
  }

  /**
   * Delaying close is only applicable to the "Keep closed" message.
   *
   * We can show the message under these conditions:
   * - User has already seen the new location notification card
   * - The message was never seen before
   * - User clicked the close button at least 5 times in a session (i.e. met the minimum of 4 counts before this point)
   * - The number of close attempts in a session is less than 7 (i.e. met the maximum of 6 counts before this point)
   *
   * Do not show the message again after the 7th close.
   */
  _canShowKeepClosedMessageOnCloseButtonClick() {
    if (
      !RPMGetBoolPref(SHOW_KEEP_SIDEBAR_CLOSED_MESSAGE_PREF, false) ||
      this.showOnboarding
    ) {
      return false;
    }

    let sidebarClosedCount = RPMGetIntPref(SIDEBAR_CLOSED_COUNT_PREF, 0);
    let canShowKeepClosedMessage =
      !this.showingKeepClosedMessage &&
      sidebarClosedCount >= CLOSED_COUNT_PREVIOUS_MIN;

    if (canShowKeepClosedMessage) {
      this.showingKeepClosedMessage = true;
      return true;
    }

    this.showingKeepClosedMessage = false;

    if (sidebarClosedCount >= CLOSED_COUNT_PREVIOUS_MAX) {
      RPMSetPref(SHOW_KEEP_SIDEBAR_CLOSED_MESSAGE_PREF, false);
    } else {
      RPMSetPref(SIDEBAR_CLOSED_COUNT_PREF, sidebarClosedCount + 1);
    }

    return false;
  }
}

customElements.define("shopping-container", ShoppingContainer);
