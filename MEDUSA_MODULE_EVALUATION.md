# Medusa v1 evaluation

Provider pin: Medusa 2.21.2. Bounded native fetch avoids importing the backend dependency graph or JS SDK retries/loggers. Only Admin product/order GETs are supported. Authentication uses Basic base64(secret + ":"), following the pinned SDK client.

The independent Nuxt module requires Jobs and Webhooks; application-owned schemas, authorization, routes and worker composition remain explicit. Product/order hints use the application bridge Standard Webhooks protocol; Medusa Cloud deployment webhooks are excluded.

Compatibility gate: actual pinned disposable backend, selected subscriber shapes including order.placed, Admin response fields and arbitrary precision totals must be proved before release. Protocol fixtures alone do not certify Medusa compatibility.

Sources: [release](https://github.com/medusajs/medusa/releases/tag/v2.21.2), [pinned SDK](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/js-sdk/src/client.ts), [product events](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/utils/src/product/events.ts), [subscribers](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers), [order events](https://docs.medusajs.com/resources/references/order/events).

## Native source and fixture finding

`ProductEvents.PRODUCT_CREATED` is `product.product.created` in the pinned utility. The public product workflows separately emit `ProductWorkflowEvents.CREATED` as `product.created`, with individual `{id}` messages. The bridge therefore subscribes to workflow events; direct product module mutation needs explicit/manual repair. The pinned complete-cart workflow emits `OrderWorkflowEvents.PLACED` with `{id:createdOrder.id}`. Fixtures use real event infrastructure and the source-proven payload without invoking checkout/payment workflows.

Sources: [create-products workflow](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/product/workflows/create-products.ts), [complete-cart workflow](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/cart/workflows/complete-cart.ts), [emit-event step](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/common/steps/emit-event.ts).
