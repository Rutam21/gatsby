import React from "react"
import ReactDOM from "react-dom"
import domReady from "@mikaelkristiansson/domready"
import io from "socket.io-client"

import socketIo from "./socketIo"
import emitter from "./emitter"
import { apiRunner, apiRunnerAsync } from "./api-runner-browser"
import { setLoader, publicLoader } from "./loader"
import { Indicator } from "./loading-indicator/indicator"
import DevLoader from "./dev-loader"
import asyncRequires from "$virtual/async-requires"
// Generated during bootstrap
import matchPaths from "$virtual/match-paths.json"
import { LoadingIndicatorEventHandler } from "./loading-indicator"
import Root from "./root"
import { init as navigationInit } from "./navigation"
// ensure in develop we have at least some .css (even if it's empty).
// this is so there is no warning about not matching content-type when site doesn't include any regular css (for example when css-in-js is used)
// this also make sure that if all css is removed in develop we are not left with stale commons.css that have stale content
import "./blank.css"

// Enable fast-refresh for virtual sync-requires, gatsby-browser & navigation
// To ensure that our <Root /> component can hot reload in case anything below doesn't
// satisfy fast-refresh constraints
module.hot.accept([
  `$virtual/async-requires`,
  `./api-runner-browser`,
  `./navigation`,
])

window.___emitter = emitter

if (
  process.env.GATSBY_EXPERIMENTAL_CONCURRENT_FEATURES &&
  !ReactDOM.createRoot
) {
  throw new Error(
    `The GATSBY_EXPERIMENTAL_CONCURRENT_FEATURES flag is not compatible with your React version. Please install "react@0.0.0-experimental-2bf4805e4" and "react-dom@0.0.0-experimental-2bf4805e4" or higher.`
  )
}

const loader = new DevLoader(asyncRequires, matchPaths)
setLoader(loader)
loader.setApiRunner(apiRunner)

window.___loader = publicLoader

// Do dummy dynamic import so the jsonp __webpack_require__.e is added to the commons.js
// bundle. This ensures hot reloading doesn't break when someone first adds
// a dynamic import.
//
// Without this, the runtime breaks with a
// "TypeError: __webpack_require__.e is not a function"
// error.
export function notCalledFunction() {
  return import(`./dummy`)
}

// Let the site/plugins run code very early.
apiRunnerAsync(`onClientEntry`).then(() => {
  // Hook up the client to socket.io on server
  const socket = socketIo()
  if (socket) {
    socket.on(`reload`, () => {
      window.location.reload()
    })
  }

  fetch(`/___services`)
    .then(res => res.json())
    .then(services => {
      if (services.developstatusserver) {
        let isRestarting = false
        const parentSocket = io(
          `${window.location.protocol}//${window.location.hostname}:${services.developstatusserver.port}`
        )

        parentSocket.on(`structured-log`, msg => {
          if (
            !isRestarting &&
            msg.type === `LOG_ACTION` &&
            msg.action.type === `DEVELOP` &&
            msg.action.payload === `RESTART_REQUIRED` &&
            window.confirm(
              `The develop process needs to be restarted for the changes to ${msg.action.dirtyFile} to be applied.\nDo you want to restart the develop process now?`
            )
          ) {
            isRestarting = true
            parentSocket.emit(`develop:restart`, () => {
              window.location.reload()
            })
          }

          if (
            isRestarting &&
            msg.type === `LOG_ACTION` &&
            msg.action.type === `SET_STATUS` &&
            msg.action.payload === `SUCCESS`
          ) {
            isRestarting = false
            window.location.reload()
          }
        })

        // Prevents certain browsers spamming XHR 'ERR_CONNECTION_REFUSED'
        // errors within the console, such as when exiting the develop process.
        parentSocket.on(`disconnect`, () => {
          console.warn(
            `[socket.io] Disconnected. Unable to perform health-check.`
          )
          parentSocket.close()
        })
      }
    })

  /**
   * Service Workers are persistent by nature. They stick around,
   * serving a cached version of the site if they aren't removed.
   * This is especially frustrating when you need to test the
   * production build on your local machine.
   *
   * Let's warn if we find service workers in development.
   */
  if (`serviceWorker` in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      if (registrations.length > 0)
        console.warn(
          `Warning: found one or more service workers present.`,
          `If your site isn't behaving as expected, you might want to remove these.`,
          registrations
        )
    })
  }

  const rootElement = document.getElementById(`___gatsby`)

  const focusEl = document.getElementById(`gatsby-focus-wrapper`)

  // Client only pages have any empty body so we just do a normal
  // render to avoid React complaining about hydration mis-matches.
  let defaultRenderer = ReactDOM.render
  if (focusEl && focusEl.children.length) {
    if (
      process.env.GATSBY_EXPERIMENTAL_CONCURRENT_FEATURES &&
      ReactDOM.createRoot
    ) {
      defaultRenderer = ReactDOM.createRoot
    } else {
      defaultRenderer = ReactDOM.hydrate
    }
  }

  const renderer = apiRunner(
    `replaceHydrateFunction`,
    undefined,
    defaultRenderer
  )[0]

  let dismissLoadingIndicator
  if (
    process.env.GATSBY_EXPERIMENTAL_QUERY_ON_DEMAND &&
    process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
  ) {
    let indicatorMountElement

    const showIndicatorTimeout = setTimeout(() => {
      indicatorMountElement = document.createElement(
        `first-render-loading-indicator`
      )
      document.body.append(indicatorMountElement)
      ReactDOM.render(<Indicator />, indicatorMountElement)
    }, 1000)

    dismissLoadingIndicator = () => {
      clearTimeout(showIndicatorTimeout)
      if (indicatorMountElement) {
        ReactDOM.unmountComponentAtNode(indicatorMountElement)
        indicatorMountElement.remove()
      }
    }
  }

  Promise.all([
    loader.loadPage(`/dev-404-page/`),
    loader.loadPage(`/404.html`),
    loader.loadPage(window.location.pathname),
  ]).then(() => {
    navigationInit()

    function onHydrated() {
      apiRunner(`onInitialClientRender`)

      // Render query on demand overlay
      if (
        process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR &&
        process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
      ) {
        const indicatorMountElement = document.createElement(`div`)
        indicatorMountElement.setAttribute(
          `id`,
          `query-on-demand-indicator-element`
        )
        document.body.append(indicatorMountElement)

        if (renderer === ReactDOM.createRoot) {
          renderer(indicatorMountElement).render(
            <LoadingIndicatorEventHandler />
          )
        } else {
          renderer(<LoadingIndicatorEventHandler />, indicatorMountElement)
        }
      }
    }

    function App() {
      const onClientEntryRanRef = React.useRef(false)

      React.useEffect(() => {
        if (!onClientEntryRanRef.current) {
          onClientEntryRanRef.current = true

          onHydrated()
        }
      }, [])

      return <Root />
    }

    domReady(() => {
      if (dismissLoadingIndicator) {
        dismissLoadingIndicator()
      }

      if (renderer === ReactDOM.createRoot) {
        renderer(rootElement, {
          hydrate: true,
        }).render(<App />)
      } else {
        renderer(<App />, rootElement)
      }
    })
  })
})
