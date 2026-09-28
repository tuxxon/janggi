/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
/* Modified for janggi (2026-09-28): fetch handler handles 304/204/205 (see "janggi:" comments).
   Upstream master has the same handler; WebKit fails to load the Fairy-Stockfish pthread worker without this. */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        const wrap = (response) => {
            if (response.status === 0) {
                return response;
            }

            const newHeaders = new Headers(response.headers);
            newHeaders.set("Cross-Origin-Embedder-Policy",
                coepCredentialless ? "credentialless" : "require-corp"
            );
            if (!coepCredentialless) {
                newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
            }
            newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

            // janggi: 204/205 는 본문을 가질 수 없다 — body 를 넘기면 Response 생성자가 TypeError 를 던진다.
            return new Response([204, 205].includes(response.status) ? null : response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders,
            });
        };
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // janggi: WebKit 은 캐시된 워커 스크립트에 조건부 요청을 보내 304 를 받는다. 304 는 본문이 없어
                    // 헤더를 붙인 새 Response 를 만들 수 없으므로(TypeError → 워커 로드 실패) 캐시를 거치지 않고 다시 받는다.
                    if (response.status === 304) {
                        return fetch(r.url, { cache: "no-store", credentials: r.credentials }).then(wrap);
                    }
                    return wrap(response);
                })
                .catch((e) => console.error(e))
        );
    });

} else {
    (() => {
        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => true,
            shouldDeregister: () => false,
            coepCredentialless: () => !(window.chrome || window.netscape),
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;

        if (n.serviceWorker && n.serviceWorker.controller) {
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: coi.coepCredentialless(),
            });

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Chrome incognito mode) this won't be available
        if (n.serviceWorker) {
            n.serviceWorker.register(window.document.currentScript.src).then(
                (registration) => {
                    !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                    registration.addEventListener("updatefound", () => {
                        !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                        coi.doReload();
                    });

                    // If the registration is active, but it's not controlling the page
                    if (registration.active && !n.serviceWorker.controller) {
                        !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                        coi.doReload();
                    }
                },
                (err) => {
                    !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
                }
            );
        }
    })();
}
