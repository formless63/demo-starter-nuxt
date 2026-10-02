/** Framework-independent, closed version-1 graph document contract. */
export interface GraphNode {
	id: string;
	kind: "default";
	position: { x: number; y: number };
	label: string;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle: "out";
	targetHandle: "in";
	label?: string;
}

export interface GraphViewport {
	x: number;
	y: number;
	zoom: number;
}

export interface GraphDocument {
	schemaVersion: 1;
	nodes: GraphNode[];
	edges: GraphEdge[];
	viewport?: GraphViewport;
}

export const GRAPH_LIMITS = Object.freeze({
	maxBytes: 1024 * 1024,
	maxNodes: 500,
	maxEdges: 1000,
	maxIdLength: 128,
	maxLabelLength: 1000,
	maxCoordinate: 1_000_000,
	minZoom: 0.1,
	maxZoom: 4,
});

/** Contains no input, parser diagnostics, identifiers, labels, or policy errors. */
export class GraphValidationError extends Error {
	constructor() {
		super(
			"Invalid graph document. Check the version, fields, connections, and limits.",
		);
		this.name = "GraphValidationError";
	}
}

export interface ReadonlyGraphDocument {
	readonly schemaVersion: 1;
	readonly nodes: readonly Readonly<
		Omit<GraphNode, "position"> & {
			readonly position: Readonly<GraphNode["position"]>;
		}
	>[];
	readonly edges: readonly Readonly<GraphEdge>[];
	readonly viewport?: Readonly<GraphViewport>;
}

/** Application-owned restrictions may narrow, but cannot relax, v1 validation. */
export type ConnectionPolicy = (
	edge: Readonly<GraphEdge>,
	graph: ReadonlyGraphDocument,
) => boolean;

type JsonRecord = Record<string, unknown>;

function invalid(): never {
	throw new GraphValidationError();
}

/** Do not expose arbitrary exceptions from proxies or application predicates. */
function boundary<T>(operation: () => T): T {
	try {
		return operation();
	} catch {
		throw new GraphValidationError();
	}
}

/** Count UTF-8 without allocating an encoded copy or importing a platform API. */
function checkText(value: string, maxBytes = Number.POSITIVE_INFINITY): void {
	if (value.length > maxBytes) invalid();
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 0 || code === 13) invalid();
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
			bytes += 4;
		} else {
			if (code >= 0xdc00 && code <= 0xdfff) invalid();
			bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
		}
		if (bytes > maxBytes) invalid();
	}
}

function text(value: unknown, maximum: number, nonempty = false): string {
	// Lengths are UTF-16 code units, matching browser text inputs / String.length.
	if (
		typeof value !== "string" ||
		value.length > maximum ||
		(nonempty && value.length === 0)
	) {
		invalid();
	}
	checkText(value);
	return value;
}

function id(value: unknown): string {
	return text(value, GRAPH_LIMITS.maxIdLength, true);
}

function finite(value: unknown, minimum: number, maximum: number): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < minimum ||
		value > maximum
	) {
		invalid();
	}
	return value === 0 ? 0 : value;
}

function coordinate(value: unknown): number {
	return finite(value, -GRAPH_LIMITS.maxCoordinate, GRAPH_LIMITS.maxCoordinate);
}

/** Read descriptors, never property values, until data-only shape is established. */
function record(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): JsonRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		invalid();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) invalid();
	// Stop early for large ordinary objects before allocating the full key list.
	for (const key in value) {
		if (!Object.hasOwn(value, key)) invalid();
		if (!required.includes(key) && !optional.includes(key)) invalid();
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length > required.length + optional.length) invalid();
	const result: JsonRecord = Object.create(null);
	for (const key of keys) {
		if (
			typeof key !== "string" ||
			(!required.includes(key) && !optional.includes(key))
		) {
			invalid();
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
			invalid();
		}
		result[key] = descriptor.value;
	}
	for (const key of required) {
		if (!Object.hasOwn(result, key)) invalid();
	}
	return result;
}

/** Bound length before walking items; reject holes, accessors, and extra keys. */
function array(value: unknown, maximum: number): unknown[] {
	if (
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype
	) {
		invalid();
	}
	const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
	if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
		invalid();
	for (const key in value) {
		if (!Object.hasOwn(value, key) || !/^(0|[1-9]\d*)$/.test(key)) invalid();
		if (Number(key) >= length) invalid();
	}
	if (Reflect.ownKeys(value).length !== length + 1) invalid();
	const result: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, index);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
			invalid();
		}
		result.push(descriptor.value);
	}
	return result;
}

function canonicalNode(value: unknown): GraphNode {
	const node = record(value, ["id", "kind", "position", "label"]);
	if (node.kind !== "default") invalid();
	const position = record(node.position, ["x", "y"]);
	return {
		id: id(node.id),
		kind: "default",
		position: { x: coordinate(position.x), y: coordinate(position.y) },
		label: text(node.label, GRAPH_LIMITS.maxLabelLength),
	};
}

function canonicalEdge(value: unknown): GraphEdge {
	const edge = record(
		value,
		["id", "source", "target", "sourceHandle", "targetHandle"],
		["label"],
	);
	if (edge.sourceHandle !== "out" || edge.targetHandle !== "in") invalid();
	const result: GraphEdge = {
		id: id(edge.id),
		source: id(edge.source),
		target: id(edge.target),
		sourceHandle: "out",
		targetHandle: "in",
	};
	if (Object.hasOwn(edge, "label")) {
		result.label = text(edge.label, GRAPH_LIMITS.maxLabelLength);
	}
	return result;
}

function canonicalViewport(value: unknown): GraphViewport {
	const viewport = record(value, ["x", "y", "zoom"]);
	return {
		x: coordinate(viewport.x),
		y: coordinate(viewport.y),
		zoom: finite(viewport.zoom, GRAPH_LIMITS.minZoom, GRAPH_LIMITS.maxZoom),
	};
}

function canonicalGraph(value: unknown): GraphDocument {
	const graph = record(
		value,
		["schemaVersion", "nodes", "edges"],
		["viewport"],
	);
	if (graph.schemaVersion !== 1) invalid();
	// Check both collection limits before visiting any node or edge.
	const nodeValues = array(graph.nodes, GRAPH_LIMITS.maxNodes);
	const edgeValues = array(graph.edges, GRAPH_LIMITS.maxEdges);
	const identifiers = new Set<string>();
	const nodeIds = new Set<string>();
	const nodes = nodeValues.map((value) => {
		const node = canonicalNode(value);
		if (identifiers.has(node.id)) invalid();
		identifiers.add(node.id);
		nodeIds.add(node.id);
		return node;
	});
	// Nested sets avoid ambiguous delimiter joins for arbitrary, valid string IDs.
	const connections = new Map<string, Set<string>>();
	const edges = edgeValues.map((value) => {
		const edge = canonicalEdge(value);
		if (
			identifiers.has(edge.id) ||
			!nodeIds.has(edge.source) ||
			!nodeIds.has(edge.target) ||
			edge.source === edge.target
		) {
			invalid();
		}
		const targets = connections.get(edge.source) ?? new Set<string>();
		if (targets.has(edge.target)) invalid();
		targets.add(edge.target);
		connections.set(edge.source, targets);
		identifiers.add(edge.id);
		return edge;
	});
	const result: GraphDocument = { schemaVersion: 1, nodes, edges };
	if (Object.hasOwn(graph, "viewport")) {
		result.viewport = canonicalViewport(graph.viewport);
	}
	checkText(JSON.stringify(result), GRAPH_LIMITS.maxBytes);
	return result;
}

/** Validate unknown data and return a fresh, canonical, deeply detached clone. */
export function validateGraph(value: unknown): GraphDocument {
	return boundary(() => canonicalGraph(value));
}

/** Bound UTF-8 bytes and malformed text before JSON parsing / object allocation. */
export function parseGraph(serialized: string): GraphDocument {
	return boundary(() => {
		if (typeof serialized !== "string") invalid();
		checkText(serialized, GRAPH_LIMITS.maxBytes);
		return canonicalGraph(JSON.parse(serialized));
	});
}

/** Stable field order and HTML-safe JSON. Node/edge array order is preserved. */
export function serializeGraph(value: unknown): string {
	return boundary(() => {
		const serialized = JSON.stringify(canonicalGraph(value)).replace(
			/[<>&\u2028\u2029]/g,
			(character) =>
				`\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
		// Escaping can expand otherwise-valid input; exports must remain importable.
		checkText(serialized, GRAPH_LIMITS.maxBytes);
		return serialized;
	});
}

function frozenSnapshot(graph: GraphDocument): ReadonlyGraphDocument {
	for (const node of graph.nodes) {
		Object.freeze(node.position);
		Object.freeze(node);
	}
	for (const edge of graph.edges) Object.freeze(edge);
	Object.freeze(graph.nodes);
	Object.freeze(graph.edges);
	if (graph.viewport) Object.freeze(graph.viewport);
	return Object.freeze(graph);
}

/** Atomically propose one edge. A rejected proposal never changes its input. */
export function proposeConnection(
	value: unknown,
	edge: unknown,
	policy?: ConnectionPolicy,
): GraphDocument {
	return boundary(() => {
		const graph = canonicalGraph(value);
		if (graph.edges.length >= GRAPH_LIMITS.maxEdges) invalid();
		const proposed = canonicalGraph({
			...graph,
			edges: [...graph.edges, edge],
		});
		if (policy !== undefined) {
			if (typeof policy !== "function") invalid();
			const proposedEdge = Object.freeze({
				...proposed.edges[proposed.edges.length - 1],
			});
			if (policy(proposedEdge, frozenSnapshot(graph)) !== true) invalid();
		}
		return proposed;
	});
}

/** Remove a node and every incoming/outgoing edge in one fresh graph result. */
export function deleteGraphNode(value: unknown, nodeId: string): GraphDocument {
	return boundary(() => {
		const graph = canonicalGraph(value);
		const deleted = id(nodeId);
		graph.nodes = graph.nodes.filter((node) => node.id !== deleted);
		graph.edges = graph.edges.filter(
			(edge) => edge.source !== deleted && edge.target !== deleted,
		);
		return graph;
	});
}
