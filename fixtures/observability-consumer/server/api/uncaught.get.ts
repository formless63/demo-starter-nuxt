export default defineEventHandler(() => {
  throw new Error('UNCAUGHT_SECRET postgres://user:UNCAUGHT_DB_SECRET@localhost/db')
})
