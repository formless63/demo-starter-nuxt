# Medusa v1

Implementation in progress against frozen Nuxt main `7d2490cd964d0d76be25c300104d3412a3f7cead`.

Hard dependencies: Jobs and Webhooks. Optional application wiring: Object Storage, Organizations and Search. Clean consumers require explicit installation (`defaultInstalled: false`).

The target provider is Medusa 2.21.2. Admin-only product/order reads refresh existing server-owned scoped bindings. No storefront, commerce writes, account provisioning or provider calls at startup. The application-owned subscriber bridge uses `application-bridge.standard-webhooks-v1`; it is not a Medusa-native commerce signature.

Actual pinned backend and bridge compatibility is unverified and remains a release blocker. No readiness promotion, merge, deployment or publication is authorized.
