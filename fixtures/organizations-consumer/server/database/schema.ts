// Baseline authentication remains application-owned; optional tables come from the package.
export { user, session, account, verification } from '../../.fixture/upstream-schema'
export { organization, member, invitation } from '@repo/nuxt-organizations/schema'
