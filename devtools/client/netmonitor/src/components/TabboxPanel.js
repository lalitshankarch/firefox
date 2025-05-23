/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  Component,
  createFactory,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");
const {
  connect,
} = require("resource://devtools/client/shared/vendor/react-redux.js");
const {
  L10N,
} = require("resource://devtools/client/netmonitor/src/utils/l10n.js");
const {
  PANELS,
} = require("resource://devtools/client/netmonitor/src/constants.js");
const {
  getOverriddenUrl,
} = require("resource://devtools/client/netmonitor/src/selectors/index.js");

// Components
const Tabbar = createFactory(
  require("resource://devtools/client/shared/components/tabs/TabBar.js")
);
const TabPanel = createFactory(
  ChromeUtils.importESModule(
    "resource://devtools/client/shared/components/tabs/Tabs.mjs"
  ).TabPanel
);
const CookiesPanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/CookiesPanel.js")
);
const HeadersPanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/HeadersPanel.js")
);
const RequestPanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/RequestPanel.js")
);
const CachePanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/CachePanel.js")
);
const ResponsePanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/ResponsePanel.js")
);
const SecurityPanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/SecurityPanel.js")
);
const StackTracePanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/StackTracePanel.js")
);
const TimingsPanel = createFactory(
  require("resource://devtools/client/netmonitor/src/components/request-details/TimingsPanel.js")
);

const COLLAPSE_DETAILS_PANE = L10N.getStr("collapseDetailsPane");
const ALL_TABS_MENU_BUTTON_TOOLTIP = L10N.getStr("allTabsMenuButton.tooltip");
const CACHE_TITLE = L10N.getStr("netmonitor.tab.cache");
const COOKIES_TITLE = L10N.getStr("netmonitor.tab.cookies");
const HEADERS_TITLE = L10N.getStr("netmonitor.tab.headers");
const REQUEST_TITLE = L10N.getStr("netmonitor.tab.request");
const RESPONSE_TITLE = L10N.getStr("netmonitor.tab.response");
const SECURITY_TITLE = L10N.getStr("netmonitor.tab.security");
const STACK_TRACE_TITLE = L10N.getStr("netmonitor.tab.stackTrace");
const TIMINGS_TITLE = L10N.getStr("netmonitor.tab.timings");

/**
 * Tabbox panel component
 * Display the network request details
 */
class TabboxPanel extends Component {
  static get propTypes() {
    return {
      activeTabId: PropTypes.string,
      cloneSelectedRequest: PropTypes.func,
      connector: PropTypes.object.isRequired,
      openLink: PropTypes.func,
      request: PropTypes.object,
      selectTab: PropTypes.func.isRequired,
      sourceMapURLService: PropTypes.object,
      hideToggleButton: PropTypes.bool,
      toggleNetworkDetails: PropTypes.func,
      openNetworkDetails: PropTypes.func.isRequired,
      showMessagesView: PropTypes.bool,
      targetSearchResult: PropTypes.object,
      defaultRawResponse: PropTypes.bool,
      setDefaultRawResponse: PropTypes.func,
      isOverridden: PropTypes.bool,
      overriddenUrl: PropTypes.string,
    };
  }
  static get defaultProps() {
    return {
      showMessagesView: true,
    };
  }
  componentDidMount() {
    this.closeOnEscRef = this.closeOnEsc.bind(this);
    window.addEventListener("keydown", this.closeOnEscRef);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.closeOnEscRef);
  }

  closeOnEsc(event) {
    if (event.key == "Escape") {
      event.preventDefault();
      this.props.openNetworkDetails(false);
    }
  }

  render() {
    const {
      activeTabId,
      cloneSelectedRequest = () => {},
      connector,
      hideToggleButton,
      openLink,
      defaultRawResponse,
      isOverridden,
      overriddenUrl,
      request,
      selectTab,
      setDefaultRawResponse,
      sourceMapURLService,
      toggleNetworkDetails,
      targetSearchResult,
    } = this.props;

    if (!request) {
      return null;
    }

    const isWs = request.cause.type === "websocket";
    const isSse = request.isEventStream;

    const showMessagesView = (isWs || isSse) && this.props.showMessagesView;
    return Tabbar(
      {
        activeTabId,
        menuDocument: window.parent.document,
        onSelect: selectTab,
        renderOnlySelected: true,
        showAllTabsMenu: true,
        allTabsMenuButtonTooltip: ALL_TABS_MENU_BUTTON_TOOLTIP,
        sidebarToggleButton: hideToggleButton
          ? null
          : {
              collapsed: false,
              collapsePaneTitle: COLLAPSE_DETAILS_PANE,
              expandPaneTitle: "",
              onClick: toggleNetworkDetails,
            },
      },
      TabPanel(
        {
          id: PANELS.HEADERS,
          title: HEADERS_TITLE,
          className: "panel-with-code",
        },
        HeadersPanel({
          cloneSelectedRequest,
          connector,
          openLink,
          request,
          targetSearchResult,
        })
      ),
      TabPanel(
        {
          id: PANELS.COOKIES,
          title: COOKIES_TITLE,
          className: "panel-with-code",
        },
        CookiesPanel({
          connector,
          openLink,
          request,
          targetSearchResult,
        })
      ),
      TabPanel(
        {
          id: PANELS.REQUEST,
          title: REQUEST_TITLE,
          className: "panel-with-code",
        },
        RequestPanel({
          connector,
          openLink,
          request,
          targetSearchResult,
        })
      ),
      TabPanel(
        {
          id: PANELS.RESPONSE,
          title: RESPONSE_TITLE,
          className:
            "panel-with-code" +
            (isOverridden ? " tab-response-overridden" : ""),
          tooltip: isOverridden
            ? L10N.getFormatStr(
                "netmonitor.tab.response-overridden.tooltip",
                overriddenUrl
              )
            : RESPONSE_TITLE,
        },
        ResponsePanel({
          request,
          openLink,
          connector,
          showMessagesView,
          targetSearchResult,
          defaultRawResponse,
          setDefaultRawResponse,
        })
      ),
      (request.fromCache || request.status == "304") &&
        TabPanel(
          {
            id: PANELS.CACHE,
            title: CACHE_TITLE,
          },
          CachePanel({ request, openLink, connector })
        ),
      TabPanel(
        {
          id: PANELS.TIMINGS,
          title: TIMINGS_TITLE,
        },
        TimingsPanel({
          connector,
          request,
        })
      ),
      request.cause?.stacktraceAvailable &&
        TabPanel(
          {
            id: PANELS.STACK_TRACE,
            title: STACK_TRACE_TITLE,
            className: "panel-with-code",
          },
          StackTracePanel({ connector, openLink, request, sourceMapURLService })
        ),
      request.securityState &&
        request.securityState !== "insecure" &&
        TabPanel(
          {
            id: PANELS.SECURITY,
            title: SECURITY_TITLE,
          },
          SecurityPanel({
            connector,
            openLink,
            request,
          })
        )
    );
  }
}

module.exports = {
  ConnectedTabboxPanel: connect(
    (state, props) => {
      const overriddenUrl = getOverriddenUrl(
        state,
        props.request.urlDetails?.url
      );
      return {
        isOverridden: !!overriddenUrl,
        overriddenUrl,
      };
    },
    {},
    undefined,
    { storeKey: "toolbox-store" }
  )(TabboxPanel),
  // Export the non-connected variant of the component for the browser console
  // which might not have toolbox store available.
  TabboxPanel,
};
