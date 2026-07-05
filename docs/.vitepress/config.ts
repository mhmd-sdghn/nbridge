import { defineConfig } from "vitepress";

export default defineConfig({
  title: "nBridge",
  description:
    "Type-safe, real-time communication between web apps and their hosts — Android WebView, iOS WKWebView, and iframes — with one API.",
  cleanUrls: true,

  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }]],

  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      {
        text: "Reference",
        link: "/reference/bridge-config",
        activeMatch: "/reference/",
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Core Concepts", link: "/guide/core-concepts" },
          ],
        },
        {
          text: "Messaging",
          items: [
            { text: "Schemas & Validation", link: "/guide/schemas" },
            { text: "Request & Response", link: "/guide/request-response" },
            { text: "Middleware", link: "/guide/middleware" },
          ],
        },
        {
          text: "Features",
          items: [
            { text: "Batching", link: "/guide/features/batching" },
            { text: "Compression", link: "/guide/features/compression" },
            { text: "Offline Queue", link: "/guide/features/offline-queue" },
            { text: "Metrics", link: "/guide/features/metrics" },
          ],
        },
        {
          text: "Integrations",
          items: [
            { text: "React", link: "/guide/react" },
            { text: "Next.js", link: "/guide/nextjs" },
            { text: "DevTools", link: "/guide/devtools" },
          ],
        },
        {
          text: "Platforms",
          items: [
            { text: "Android WebView", link: "/guide/platforms/android" },
            { text: "iOS WKWebView", link: "/guide/platforms/ios" },
            { text: "Iframe", link: "/guide/platforms/iframe" },
            { text: "Plain Web", link: "/guide/platforms/web" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Bridge Config", link: "/reference/bridge-config" },
            { text: "BridgeManager", link: "/reference/bridge-manager" },
            { text: "Wire Protocol", link: "/reference/protocol" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/mhmd-sdghn/nbridge" },
    ],

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Mo Sadeghian",
    },
  },
});
