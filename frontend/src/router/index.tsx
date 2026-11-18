import { createBrowserRouter, Navigate } from "react-router-dom";
import { App } from "../App.tsx";
import ErrorBoundary from "../component/Common/ErrorBoundary.tsx";
import HeadlessFrame from "../component/Frame/HeadlessFrame.tsx";
import { HomeRedirect } from "../component/Pages/HomeRedirect.tsx";
import Activate from "../component/Pages/Login/Activate.tsx";
import ActivateEmailChange from "../component/Pages/Login/ActivateEmailChange.tsx";
import Authorize from "../component/Pages/Login/Authorize.tsx";
import Reset from "../component/Pages/Login/Reset.tsx";
import SessionIntro from "../component/Pages/Login/SessionIntro.tsx";
import DesktopCallback from "../component/Pages/Login/Signin/DesktopCallback.tsx";
import MobileCallback from "../component/Pages/Login/Signin/MobileCallback.tsx";
import SSOCallback from "../component/Pages/Login/Signin/SSOCallback.tsx";
import SignIn from "../component/Pages/Login/Signin/SignIn.tsx";
import SignUp from "../component/Pages/Login/Signup.tsx";
import NoMatch from "../component/Pages/NoMatch.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    errorElement: <ErrorBoundary />,
    element: <App />,
    children: [
      { path: "/", element: <HomeRedirect /> },
      {
        path: "/",
        element: <HeadlessFrame />,
        children: [
          {
            path: "/session",
            element: <SessionIntro />,
            children: [
              {
                path: "/session",
                element: <SignIn />,
              },
              {
                path: "signup",
                element: <SignUp />,
              },
              {
                path: "activate",
                element: <Activate />,
              },
              {
                path: "activate_email",
                element: <ActivateEmailChange />,
              },
              {
                path: "reset",
                element: <Reset />,
              },
              {
                path: "authorize",
                element: <Authorize />,
              },
            ],
          },
          {
            path: "*",
            element: <NoMatch />,
          },
        ],
      },
      {
        path: "/callback",
        element: <HeadlessFrame />,
        children: [
          {
            path: "desktop",
            element: <DesktopCallback />,
          },
          {
            path: "ios",
            element: <MobileCallback />,
          },
          {
            path: "sso",
            element: <SSOCallback />,
          },
        ],
      },
      {
        path: "/",
        async lazy() {
          const { AutoNavbarFrame } = await import("../component/Frame/FrameManagerBundle.tsx");
          return { Component: AutoNavbarFrame };
        },
        children: [
          {
            path: "/admin",
            children: [
              {
                path: "/admin",
                element: <Navigate to={"/admin/home"} />,
              },
              {
                path: "home",
                async lazy() {
                  const { Home } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: Home };
                },
              },
              {
                path: "settings",
                async lazy() {
                  const { Settings } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: Settings };
                },
              },

              {
                path: "policy",
                async lazy() {
                  const { StoragePolicySetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: StoragePolicySetting };
                },
              },
              {
                path: "policy/:id",
                async lazy() {
                  const { EditStoragePolicy } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EditStoragePolicy };
                },
              },
              {
                path: "policy/oauth",
                async lazy() {
                  const { OauthCallback } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: OauthCallback };
                },
              },
              {
                path: "oauth",
                async lazy() {
                  const { OAuthClientSetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: OAuthClientSetting };
                },
              },
              {
                path: "oauth/new",
                async lazy() {
                  const { EditOAuthClient } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EditOAuthClient };
                },
              },
              {
                path: "oauth/:id",
                async lazy() {
                  const { EditOAuthClient } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EditOAuthClient };
                },
              },
              {
                path: "group",
                async lazy() {
                  const { GroupSetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: GroupSetting };
                },
              },
              {
                path: "group/:id",
                async lazy() {
                  const { EditGroup } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EditGroup };
                },
              },
              {
                path: "node",
                async lazy() {
                  const { NodeSetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: NodeSetting };
                },
              },
              {
                path: "node/:id",
                async lazy() {
                  const { EditNode } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EditNode };
                },
              },
              {
                path: "user",
                async lazy() {
                  const { UserSetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: UserSetting };
                },
              },
              {
                path: "file",
                async lazy() {
                  const { FileSetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: FileSetting };
                },
              },
              {
                path: "blob",
                async lazy() {
                  const { EntitySetting } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EntitySetting };
                },
              },
              {
                path: "task",
                async lazy() {
                  const { TaskList } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: TaskList };
                },
              },
              {
                path: "share",
                async lazy() {
                  const { ShareList } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: ShareList };
                },
              },
              {
                path: "event",
                async lazy() {
                  const { EventList } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: EventList };
                },
              },
              {
                path: "abuse",
                async lazy() {
                  const { AbuseReportList } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: AbuseReportList };
                },
              },
              {
                path: "filesystem",
                async lazy() {
                  const { FileSystem } = await import("../component/Admin/AdminBundle.tsx");
                  return { Component: FileSystem };
                },
              },
            ],
          },
          {
            path: "/home",
            async lazy() {
              const { FileManager } = await import("../component/Frame/FrameManagerBundle.tsx");
              return { Component: FileManager };
            },
          },
          {
            path: "/tasks",
            async lazy() {
              const { TaskList } = await import("../component/Pages/Pages");
              return { Component: TaskList };
            },
          },
          {
            path: "/downloads",
            async lazy() {
              const { DownloadList } = await import("../component/Pages/Pages");
              return { Component: DownloadList };
            },
          },
          {
            path: "/shares",
            async lazy() {
              const { ShareList } = await import("../component/Pages/Pages");
              return { Component: ShareList };
            },
          },
          {
            path: "/discover",
            async lazy() {
              const { Discover } = await import("../component/Pages/Pages");
              return { Component: Discover };
            },
          },
          {
            path: "/connect",
            async lazy() {
              const { Devices } = await import("../component/Pages/Pages");
              return { Component: Devices };
            },
          },
          {
            path: "/shop",
            async lazy() {
              const { Shop } = await import("../component/Pages/Pages");
              return { Component: Shop };
            },
          },
          {
            path: "/settings",
            async lazy() {
              const { Setting } = await import("../component/Pages/Pages");
              return { Component: Setting };
            },
          },
          {
            path: "/profile/:id",
            async lazy() {
              const { Profile } = await import("../component/Pages/Pages");
              return { Component: Profile };
            },
          },
        ],
      },
    ],
  },
]);
