# Medusa v1 evaluation

Provider pin: Medusa 2.21.2. Bounded native fetch avoids importing the backend dependency graph or JS SDK retries/loggers. Only Admin product/order GETs are supported. Authentication uses Basic base64(secret + ":"), following the pinned SDK client.

The independent Nuxt module requires Jobs and Webhooks; application-owned schemas, authorization, routes and worker composition remain explicit. Product/order hints use the application bridge Standard Webhooks protocol; Medusa Cloud deployment webhooks are excluded.

Compatibility gate passed against the actual pinned disposable 2.21.2 backend: selected subscriber shapes including `order.placed`, Basic Admin response fields and exact major-unit decimal totals. The exact operator subscriber artifact runs through real native event infrastructure and existing Jobs/scoped projections. This does not invoke checkout/payment workflows or certify production event infrastructure; deployment-specific authorization and bridge operations remain application-owned.

Sources: [release](https://github.com/medusajs/medusa/releases/tag/v2.21.2), [pinned SDK](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/js-sdk/src/client.ts), [product events](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/utils/src/product/events.ts), [subscribers](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers), [order events](https://docs.medusajs.com/resources/references/order/events).

## Native source and fixture finding

`ProductEvents.PRODUCT_CREATED` is `product.product.created` in the pinned utility. The public product workflows separately emit `ProductWorkflowEvents.CREATED` as `product.created`, with individual `{id}` messages. The bridge therefore subscribes to workflow events; direct product module mutation needs explicit/manual repair. The pinned complete-cart workflow emits `OrderWorkflowEvents.PLACED` with `{id:createdOrder.id}`. Fixtures use real event infrastructure and the source-proven payload without invoking checkout/payment workflows.

Sources: [create-products workflow](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/product/workflows/create-products.ts), [complete-cart workflow](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/cart/workflows/complete-cart.ts), [emit-event step](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/common/steps/emit-event.ts).

Completion evidence: the [combined CI run](https://github.com/formless63/demo-starter-nuxt/actions/runs/36978353705) passed all 19 jobs at `4478e41f2835bfe1495dab762756b2fec08bd98e`, including all 17 generic package lifecycles and the full application check, browser suite, explicit migrations, production container/health and worker checks. No remote provider service, Cloud account, callback registration, payment, deployment or registry publication is part of this proof.
