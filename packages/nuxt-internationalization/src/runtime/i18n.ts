import { createI18n as createVueI18n } from 'vue-i18n'

export type Direction = "ltr" | "rtl";
export type Messages = { [key: string]: string | Messages };
export interface LocaleDefinition {
	direction: Direction;
	messages: Messages;
}
export interface I18nConfig {
	locales: Record<string, LocaleDefinition>;
	defaultLocale: string;
	fallbackLocale: string;
	timeZone: string;
}
export interface I18nPayload extends I18nConfig {
	locale: string;
	formatted: Record<string, string>;
}
export type Diagnostic = "missing-message" | "missing-value";
export type Values = Record<string, string | number>;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const keyPart = /^[A-Za-z][A-Za-z0-9_-]*$/;
const token = /{([A-Za-z][A-Za-z0-9_]*)}/g;
const encoder = new TextEncoder();
function invalid(): never {
	throw new Error("Invalid internationalization configuration");
}
function plain(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
function entries(value: unknown): [string, unknown][] {
	if (!plain(value) || Object.getOwnPropertySymbols(value).length)
		return invalid();
	return Object.getOwnPropertyNames(value).map((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			forbidden.has(key) ||
			!descriptor ||
			!("value" in descriptor) ||
			!descriptor.enumerable
		)
			return invalid();
		return [key, descriptor.value];
	});
}
// Normalize before Nuxt devalue/HTTP transport, not only after hydration.
export function canonicalText(value: string): string {
 return value.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD').toWellFormed()
}
export function validateConfig(input: I18nConfig): I18nConfig {
	const config = Object.fromEntries(entries(input));
	if (
		Object.keys(config).some(
			(k) =>
				![
					"locales",
					"defaultLocale",
					"fallbackLocale",
					"timeZone",
					"locale",
					"formatted",
				].includes(k),
		)
	)
		invalid();
	const localeEntries = entries(config.locales);
	if (!localeEntries.length || localeEntries.length > 32) invalid();
	let bytes = 0;
	let keys = 0;
	const visit = (value: unknown, depth: number): Messages => {
		if (depth > 8) return invalid();
		const result: Messages = Object.create(null);
		for (const [key, item] of entries(value)) {
			if (!keyPart.test(key) || ++keys > 10_000) invalid();
			bytes += encoder.encode(key).length;
			if (typeof item === "string") {
				if (item.length > 8192) invalid();
				const canonical = canonicalText(item);
				bytes += encoder.encode(canonical).length;
				if (
					encoder.encode(item).length > 8192 ||
					encoder.encode(canonical).length > 8192 ||
					/[|@]/.test(item) ||
					/[{}]/.test(item.replace(token, ""))
				)
					invalid();
				result[key] = canonical;
			} else result[key] = visit(item, depth + 1);
			if (bytes > 1_048_576) invalid();
		}
		return result;
	};
	const locales: Record<string, LocaleDefinition> = Object.create(null);
	for (const [locale, definition] of localeEntries) {
		try {
			if (Intl.getCanonicalLocales(locale)[0] !== locale) invalid();
		} catch {
			invalid();
		}
		if (
			!Intl.PluralRules.supportedLocalesOf([locale]).length ||
			!Intl.DateTimeFormat.supportedLocalesOf([locale]).length
		)
			invalid();
		const def = Object.fromEntries(entries(definition));
		if (
			Object.keys(def).sort().join(",") !== "direction,messages" ||
			typeof def.direction !== "string" ||
			!["ltr", "rtl"].includes(def.direction)
		)
			invalid();
		locales[locale] = {
			direction: def.direction as Direction,
			messages: visit(def.messages, 1),
		};
	}
	if (encoder.encode(JSON.stringify(locales)).length > 1_048_576) invalid();
	if (
		typeof config.defaultLocale !== "string" ||
		!Object.hasOwn(locales, config.defaultLocale) ||
		typeof config.fallbackLocale !== "string" ||
		!Object.hasOwn(locales, config.fallbackLocale) ||
		typeof config.timeZone !== "string"
	)
		invalid();
	try {
		new Intl.DateTimeFormat("en", { timeZone: config.timeZone });
	} catch {
		invalid();
	}
	return {
		locales,
		defaultLocale: config.defaultLocale as string,
		fallbackLocale: config.fallbackLocale as string,
		timeZone: config.timeZone as string,
	};
}
export function resolveLocale(config: I18nConfig, requested: unknown): string {
	return typeof requested === "string" &&
		Object.hasOwn(config.locales, requested)
		? requested
		: config.defaultLocale;
}
function lookup(messages: Messages, key: string): string | undefined {
	let value: string | Messages = messages;
	for (const part of key.split(".")) {
		if (
			!keyPart.test(part) ||
			forbidden.has(part) ||
			typeof value === "string" ||
			!Object.hasOwn(value, part)
		)
			return;
		value = value[part];
	}
	return typeof value === "string" ? value : undefined;
}
export interface I18nRuntime {
  instance: ReturnType<typeof createNative>
  payload: I18nPayload
  text: (key: string, values?: Values, count?: number) => string
  number: (value: number, preset: 'decimal' | 'currency') => string
  date: (value: number, preset: 'date' | 'dateTime') => string
}
function createNative(payload: I18nPayload) {
  return createVueI18n({
    legacy: false, locale: payload.locale, fallbackLocale: false,
    messages: Object.fromEntries(Object.entries(payload.locales).map(([locale, definition]) => [locale, definition.messages])),
    missingWarn: false, fallbackWarn: false, warnHtmlMessage: false,
    escapeParameter: false,
  })
}
/** A fresh native Vue engine per application/provider; never mutable module state. */
export function createInternationalization(input: I18nPayload, diagnostic?: (code: Diagnostic) => void): I18nRuntime {
  const config = validateConfig(input)
  const own = Object.fromEntries(entries(input))
  if (resolveLocale(config, own.locale) !== own.locale) invalid()
  const formatted: Record<string, string> = Object.create(null)
  for (const [key, value] of entries(own.formatted)) {
    if (!keyPart.test(key) || typeof value !== 'string' || encoder.encode(value).length > 8192 || Object.keys(formatted).length >= 100) invalid()
    const canonical = canonicalText(value as string)
    if (encoder.encode(canonical).length > 8192) invalid()
    formatted[key] = canonical
  }
  const payload: I18nPayload = { ...config, locale: own.locale as string, formatted }
  const instance = createNative(payload)
  const emit = (code: Diagnostic) => { try { diagnostic?.(code) } catch { /* diagnostics cannot alter rendering */ } }
  return {
    instance, payload,
    text(key, values = {}, count) {
      if (typeof key !== 'string' || key.length > 256 || !key.split('.').every(part => keyPart.test(part) && !forbidden.has(part))) return 'invalid-message'
      const safe: Values = Object.create(null)
      for (const [name, value] of entries(values)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || (typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value)) || String(value).length > 8192) invalid()
        safe[name] = typeof value === 'string' ? canonicalText(value) : value as number
      }
      if (count !== undefined) { if (!Number.isFinite(count)) invalid(); safe.count = count }
      for (const locale of [...new Set([payload.locale, payload.fallbackLocale])]) {
        // CLDR categories are explicit keys, never Vue pipe-position assumptions.
        const suffix = count === undefined ? '' : `_${new Intl.PluralRules(locale).select(count)}`
        const messages = config.locales[locale]!.messages
        const messageKey = suffix && lookup(messages, key + suffix) !== undefined ? key + suffix : key
        const message = lookup(messages, messageKey)
        if (message === undefined) continue
        if ([...message.matchAll(token)].some(match => !Object.hasOwn(safe, match[1]!))) { emit('missing-value'); continue }
        return instance.global.t(messageKey, safe, { locale })
      }
      emit('missing-message')
      return key
    },
    number(value, preset) {
      if (!Number.isFinite(value) || !['decimal', 'currency'].includes(preset)) invalid()
      return new Intl.NumberFormat(payload.locale, preset === 'currency' ? { style: 'currency', currency: 'EUR' } : { maximumFractionDigits: 2 }).format(value)
    },
    date(value, preset) {
      if (!Number.isFinite(value) || !['date', 'dateTime'].includes(preset)) invalid()
      return new Intl.DateTimeFormat(payload.locale, { timeZone: payload.timeZone, dateStyle: 'medium', ...(preset === 'dateTime' ? { timeStyle: 'short' as const } : {}) }).format(value)
    },
  }
}
export type InitialFormat =
	| {
			id: string;
			kind: "number";
			value: number;
			preset: "decimal" | "currency";
	  }
	| { id: string; kind: "date"; value: number; preset: "date" | "dateTime" };
export function createPayload(
	input: I18nConfig,
	requested: unknown,
	initialValues: readonly InitialFormat[] = [],
): I18nPayload {
	const config = validateConfig(input);
	const runtime = createInternationalization({
		...config,
		locale: resolveLocale(config, requested),
		formatted: {},
	});
	try {
	// Initial values come from the server. No server/client ICU punctuation assumption.
	if (
		!Array.isArray(initialValues) ||
		Object.getPrototypeOf(initialValues) !== Array.prototype ||
		initialValues.length > 100 ||
		Object.getOwnPropertySymbols(initialValues).length
	)
		invalid();
	const descriptors = Object.getOwnPropertyDescriptors(initialValues);
	if (Object.keys(descriptors).length !== initialValues.length + 1) invalid();
	for (let index = 0; index < initialValues.length; index++) {
		const descriptor = descriptors[String(index)];
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
			invalid();
		const candidate: unknown = descriptor.value;
		const format = Object.fromEntries(entries(candidate));
		if (
			Object.keys(format).sort().join(",") !== "id,kind,preset,value" ||
			typeof format.id !== "string" ||
			!keyPart.test(format.id) ||
			forbidden.has(format.id) ||
			Object.hasOwn(runtime.payload.formatted, format.id) ||
			typeof format.value !== "number" ||
			!Number.isFinite(format.value)
		)
			invalid();
		if (
			format.kind === "date" &&
			(format.preset === "date" || format.preset === "dateTime")
		) {
			runtime.payload.formatted[format.id] = runtime.date(
				format.value,
				format.preset,
			);
		} else if (
			format.kind === "number" &&
			(format.preset === "decimal" || format.preset === "currency")
		) {
			runtime.payload.formatted[format.id] = runtime.number(
				format.value,
				format.preset,
			);
		} else invalid();
	}

	return runtime.payload;
	} finally { runtime.instance.dispose() }
}
