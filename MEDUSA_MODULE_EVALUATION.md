# Medusa v1 evaluation

Provider pin: Medusa 2.21.2. Bounded native fetch avoids importing the backend dependency graph or JS SDK retries/loggers. Only Admin product/order GETs are supported. Authentication uses Basic base64(secret + ":"), following the pinned SDK client.

The independent Nuxt module requires Jobs and Webhooks; application-owned schemas, authorization, routes and worker composition remain explicit. Product/order hints use the application bridge Standard Webhooks protocol; Medusa Cloud deployment webhooks are excluded.

Compatibility gate: actual pinned disposable backend, selected subscriber shapes including order.placed, Admin response fields and arbitrary precision totals must be proved before release. Protocol fixtures alone do not certify Medusa compatibility.

Sources: [release](https://github.com/medusajs/medusa/releases/tag/v2.21.2), [pinned SDK](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/js-sdk/src/client.ts), [product events](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/utils/src/product/events.ts), [subscribers](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers), [order events](https://docs.medusajs.com/resources/references/order/events).
