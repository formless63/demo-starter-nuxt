import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type ConnectionPolicy,
	deleteGraphNode,
	GRAPH_LIMITS,
	type GraphDocument,
	type GraphEdge,
	type GraphNode,
	GraphValidationError,
	parseGraph,
	proposeConnection,
	serializeGraph,
	validateGraph,
} from "@repo/nuxt-flow-canvas/graph";

const node = (id: string, label = id): GraphNode => ({
	id,
	kind: "default",
	position: { x: 0, y: 0 },
	label,
});
const edge = (id: string, source: string, target: string): GraphEdge => ({
	id,
	source,
	target,
	sourceHandle: "out",
	targetHandle: "in",
});
const empty = (): GraphDocument => ({ schemaVersion: 1, nodes: [], edges: [] });
const fixture = (): GraphDocument => ({
	schemaVersion: 1,
	nodes: [node("a"), node("b"), node("c")],
	edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
	viewport: { x: -25.5, y: 99, zoom: 0.75 },
});
function rejects(operation: () => unknown): void {
	assert.throws(operation, (error: unknown) => {
		assert.ok(error instanceof GraphValidationError);
		assert.equal(error.name, "GraphValidationError");
		assert.equal(error.message, new GraphValidationError().message);
		return true;
	});
}

function completeGraph(edgeCount = GRAPH_LIMITS.maxEdges): GraphDocument {
	const nodes = Array.from({ length: 40 }, (_, index) => node(`node-${index}`));
	const edges: GraphEdge[] = [];
	for (const source of nodes) {
		for (const target of nodes) {
			if (source.id !== target.id && edges.length < edgeCount) {
				edges.push(edge(`edge-${edges.length}`, source.id, target.id));
			}
		}
	}
	return { schemaVersion: 1, nodes, edges };
}

describe("graph v1 canonical document", () => {
	test("empty and populated documents round-trip without an optional viewport", () => {
		for (const value of [empty(), fixture()]) {
			assert.deepEqual(parseGraph(serializeGraph(value)), value);
			assert.deepEqual(validateGraph(value), value);
		}
		assert.equal(Object.hasOwn(validateGraph(empty()), "viewport"), false);
	});

	test("returns a fresh, fully detached clone", () => {
		const input = fixture();
		const result = validateGraph(input);
		assert.notEqual(result, input);
		assert.notEqual(result.nodes, input.nodes);
		assert.notEqual(result.nodes[0], input.nodes[0]);
		assert.notEqual(result.nodes[0].position, input.nodes[0].position);
		assert.notEqual(result.edges, input.edges);
		assert.notEqual(result.edges[0], input.edges[0]);
		assert.notEqual(result.viewport, input.viewport);
		result.nodes[0].position.x = 100;
		result.edges[0].label = "changed";
		assert.equal(input.nodes[0].position.x, 0);
		assert.equal(input.edges[0].label, undefined);
	});

	test("stable key order ignores source insertion order and preserves array order", () => {
		const input = {
			viewport: { zoom: 1, y: 3, x: 2 },
			edges: [
				{
					label: "",
					targetHandle: "in",
					sourceHandle: "out",
					target: "a",
					source: "b",
					id: "e",
				},
			],
			nodes: [
				{ label: "B", position: { y: 2, x: 1 }, kind: "default", id: "b" },
				{ label: "A", position: { y: 0, x: -0 }, kind: "default", id: "a" },
			],
			schemaVersion: 1,
		};
		assert.equal(
			serializeGraph(input),
			'{"schemaVersion":1,"nodes":[{"id":"b","kind":"default","position":{"x":1,"y":2},"label":"B"},{"id":"a","kind":"default","position":{"x":0,"y":0},"label":"A"}],"edges":[{"id":"e","source":"b","target":"a","sourceHandle":"out","targetHandle":"in","label":""}],"viewport":{"x":2,"y":3,"zoom":1}}',
		);
		assert.equal(
			Object.is(validateGraph(input).nodes[1].position.x, -0),
			false,
		);
	});

	test("HTML, attribute, ampersand and line-separator characters are escaped", () => {
		const label = '</script><img src=x onerror="alert(1)">&\u2028\u2029';
		const graph = { ...empty(), nodes: [node("<&>", label)] };
		const serialized = serializeGraph(graph);
		assert.equal(/[<>&\u2028\u2029]/.test(serialized), false);
		assert.ok(serialized.includes("\\u003c/script\\u003e"));
		assert.ok(serialized.includes("\\u0026\\u2028\\u2029"));
		assert.deepEqual(parseGraph(serialized), graph);
	});

	test("valid text preserves whitespace, LF, tabs, Unicode and surrogate pairs", () => {
		const value = { ...empty(), nodes: [node("  🦊  ", "\n\t café 中 🦊 ")] };
		assert.deepEqual(parseGraph(serializeGraph(value)), value);
		assert.equal(
			validateGraph({ ...empty(), nodes: [node("x", "")] }).nodes[0].label,
			"",
		);
	});

	test("frozen and null-prototype data objects are accepted without retaining prototypes", () => {
		const input = Object.assign(Object.create(null), empty());
		Object.freeze(input.nodes);
		Object.freeze(input.edges);
		Object.freeze(input);
		const result = validateGraph(input);
		assert.deepEqual(result, empty());
		assert.equal(Object.getPrototypeOf(result), Object.prototype);
	});
});

describe("closed data shapes and safe errors", () => {
	test("rejects nonobjects, non-v1 versions and non-array collections", () => {
		for (const input of [
			null,
			undefined,
			true,
			1,
			"graph",
			[],
			new Date(),
			new Map(),
			() => empty(),
		]) {
			rejects(() => validateGraph(input));
		}
		for (const schemaVersion of [0, 2, "1", null, NaN, Infinity, true]) {
			rejects(() => validateGraph({ ...empty(), schemaVersion }));
		}
		for (const collection of [null, {}, "", new Set(), new Uint8Array()]) {
			rejects(() => validateGraph({ ...empty(), nodes: collection }));
			rejects(() => validateGraph({ ...empty(), edges: collection }));
		}
	});

	test("all required fields must be own properties", () => {
		const cases: [Record<string, unknown>, (value: unknown) => unknown][] = [
			[fixture() as unknown as Record<string, unknown>, validateGraph],
			[
				node("a") as unknown as Record<string, unknown>,
				(value) => validateGraph({ ...empty(), nodes: [value] }),
			],
			[
				edge("ab", "a", "b") as unknown as Record<string, unknown>,
				(value) => validateGraph({ ...fixture(), edges: [value] }),
			],
			[
				{ x: 0, y: 0 },
				(value) =>
					validateGraph({
						...empty(),
						nodes: [{ ...node("a"), position: value }],
					}),
			],
			[
				{ x: 0, y: 0, zoom: 1 },
				(value) => validateGraph({ ...empty(), viewport: value }),
			],
		];
		for (const [input, validate] of cases) {
			for (const key of Object.keys(input)) {
				if (key === "viewport") continue;
				const copy = { ...input };
				Reflect.deleteProperty(copy, key);
				rejects(() => validate(copy));
			}
		}
	});

	test("unknown and prototype keys are rejected at every object level", () => {
		for (const key of ["extra", "__proto__", "constructor", "prototype"]) {
			const extra = { [key]: "secret-input" };
			for (const input of [
				{ ...fixture(), ...extra },
				{ ...fixture(), nodes: [{ ...node("a"), ...extra }] },
				{
					...fixture(),
					nodes: [{ ...node("a"), position: { x: 0, y: 0, ...extra } }],
				},
				{ ...fixture(), edges: [{ ...edge("ab", "a", "b"), ...extra }] },
				{ ...fixture(), viewport: { x: 0, y: 0, zoom: 1, ...extra } },
			])
				rejects(() => validateGraph(input));
		}
		assert.equal(Object.hasOwn(Object.prototype, "secret-input"), false);
	});

	test("symbols, hidden fields and nonenumerable required data are not JSON properties", () => {
		for (const key of [Symbol("secret"), "hidden"]) {
			const input = empty();
			Object.defineProperty(input, key, { value: "secret-input" });
			rejects(() => validateGraph(input));
		}
		const input = empty();
		Object.defineProperty(input, "schemaVersion", { enumerable: false });
		rejects(() => validateGraph(input));
	});

	test("custom prototypes, classes and array subclasses are rejected", () => {
		class Graph {
			schemaVersion = 1;
			nodes = [];
			edges = [];
		}
		class Nodes extends Array {}
		for (const input of [
			new Graph(),
			Object.assign(Object.create({ inherited: true }), empty()),
			{ ...empty(), nodes: new Nodes() },
			{
				...empty(),
				nodes: [Object.assign(Object.create({ inherited: true }), node("a"))],
			},
			{ ...fixture(), viewport: Object.create({ x: 0, y: 0, zoom: 1 }) },
		])
			rejects(() => validateGraph(input));
	});

	test("accessors and toJSON hooks are rejected without execution", () => {
		let calls = 0;
		const getter = {
			enumerable: true,
			get: () => {
				calls++;
				throw new Error("secret-input");
			},
		};
		const root = empty();
		Object.defineProperty(root, "nodes", getter);
		const entry = node("a");
		Object.defineProperty(entry, "label", getter);
		const position = { x: 0, y: 0 };
		Object.defineProperty(position, "x", getter);
		const entries = [node("a")];
		Object.defineProperty(entries, "0", getter);
		for (const input of [
			root,
			{ ...empty(), nodes: [entry] },
			{ ...empty(), nodes: [{ ...node("a"), position }] },
			{ ...empty(), nodes: entries },
			{
				...empty(),
				toJSON: () => {
					calls++;
					return empty();
				},
			},
		])
			rejects(() => serializeGraph(input));
		assert.equal(calls, 0);
	});

	test("sparse arrays, extra properties, symbols and null-prototype arrays fail", () => {
		const sparse = new Array(1);
		const extra = Object.assign([], { extra: true });
		const hidden: unknown[] = [];
		Object.defineProperty(hidden, "hidden", { value: true });
		const symbolic = Object.assign([], { [Symbol("extra")]: true });
		const prototype = Object.setPrototypeOf([], null);
		for (const nodes of [sparse, extra, hidden, symbolic, prototype]) {
			rejects(() => validateGraph({ ...empty(), nodes }));
		}
	});

	test("circular objects and exceptional/revoked proxies produce safe errors", () => {
		const circular = empty();
		(circular.nodes as unknown[]).push(circular);
		const proxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error("secret-input");
				},
			},
		);
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		for (const input of [circular, proxy, revoked.proxy])
			rejects(() => validateGraph(input));
	});

	test("invalid syntax and trailing content never leak parser diagnostics", () => {
		for (const input of [
			"",
			"undefined",
			"NaN",
			"{",
			"{secret-input}",
			`${JSON.stringify(empty())}x`,
			'{"schemaVersion":1,}',
		]) {
			rejects(() => parseGraph(input));
		}
		rejects(() => parseGraph(null as unknown as string));
		rejects(() =>
			parseGraph({
				toString: () => JSON.stringify(empty()),
			} as unknown as string),
		);
	});

	test("explicit undefined/null optional fields and wrong node or handle kinds fail", () => {
		for (const viewport of [undefined, null, 1, {}]) {
			rejects(() => validateGraph({ ...empty(), viewport }));
		}
		for (const label of [undefined, null, true, 1, {}]) {
			rejects(() =>
				validateGraph({
					...fixture(),
					edges: [{ ...edge("ab", "a", "b"), label }],
				}),
			);
		}
		for (const kind of ["input", "output", "custom", 1, null]) {
			rejects(() =>
				validateGraph({ ...empty(), nodes: [{ ...node("a"), kind }] }),
			);
		}
		for (const sourceHandle of ["in", "", null, undefined]) {
			rejects(() =>
				validateGraph({
					...fixture(),
					edges: [{ ...edge("ab", "a", "b"), sourceHandle }],
				}),
			);
		}
		for (const targetHandle of ["out", "", null, undefined]) {
			rejects(() =>
				validateGraph({
					...fixture(),
					edges: [{ ...edge("ab", "a", "b"), targetHandle }],
				}),
			);
		}
	});
});

describe("text, numeric and resource limits", () => {
	test("ID and label boundaries apply to nodes, edges and endpoints", () => {
		const longId = "i".repeat(GRAPH_LIMITS.maxIdLength);
		const label = "l".repeat(GRAPH_LIMITS.maxLabelLength);
		const input = {
			...empty(),
			nodes: [node(longId, label), node("b")],
			edges: [{ ...edge("e".repeat(128), longId, "b"), label }],
		};
		assert.deepEqual(validateGraph(input), input);
		for (const bad of ["", "i".repeat(129), 1, null, undefined]) {
			rejects(() =>
				validateGraph({ ...empty(), nodes: [{ ...node("a"), id: bad }] }),
			);
			for (const field of ["id", "source", "target"]) {
				rejects(() =>
					validateGraph({
						...fixture(),
						edges: [{ ...edge("ab", "a", "b"), [field]: bad }],
					}),
				);
			}
		}
		for (const bad of ["l".repeat(1001), 1, null, undefined]) {
			rejects(() =>
				validateGraph({ ...empty(), nodes: [{ ...node("a"), label: bad }] }),
			);
			rejects(() =>
				validateGraph({
					...fixture(),
					edges: [{ ...edge("ab", "a", "b"), label: bad }],
				}),
			);
		}
	});

	test("CR, NUL and unpaired surrogates fail for every text field, including escaped JSON", () => {
		for (const bad of [
			"secret\rinput",
			"secret\0input",
			"\ud800",
			"\udfff",
			"x\ud800y",
			"\udc00\ud800",
		]) {
			for (const field of ["id", "label"]) {
				const input = { ...empty(), nodes: [{ ...node("a"), [field]: bad }] };
				rejects(() => validateGraph(input));
				rejects(() => parseGraph(JSON.stringify(input)));
			}
			for (const field of ["id", "source", "target", "label"]) {
				rejects(() =>
					validateGraph({
						...fixture(),
						edges: [{ ...edge("ab", "a", "b"), [field]: bad }],
					}),
				);
			}
		}
		for (const raw of ["\r", "\0", "\ud800", "\udfff"]) {
			rejects(() => parseGraph(`${raw}${JSON.stringify(empty())}`));
		}
	});

	test("finite coordinate and viewport bounds are inclusive", () => {
		for (const bound of [-1_000_000, 1_000_000, 0, 1.25]) {
			for (const zoom of [0.1, 4]) {
				const input = {
					...empty(),
					nodes: [{ ...node("a"), position: { x: bound, y: bound } }],
					viewport: { x: bound, y: bound, zoom },
				};
				assert.deepEqual(validateGraph(input), input);
			}
		}
		for (const bad of [
			-1_000_001,
			1_000_001,
			NaN,
			Infinity,
			-Infinity,
			"0",
			null,
		]) {
			for (const field of ["x", "y"]) {
				rejects(() =>
					validateGraph({
						...empty(),
						nodes: [{ ...node("a"), position: { x: 0, y: 0, [field]: bad } }],
					}),
				);
				rejects(() =>
					validateGraph({
						...empty(),
						viewport: { x: 0, y: 0, zoom: 1, [field]: bad },
					}),
				);
			}
		}
		for (const zoom of [0.0999, 4.0001, 0, -1, NaN, Infinity, "1", null]) {
			rejects(() =>
				validateGraph({ ...empty(), viewport: { x: 0, y: 0, zoom } }),
			);
		}
	});

	test("exact node/edge limits work, over-limit collections fail before reading entries", () => {
		const nodes = Array.from({ length: 500 }, (_, index) => node(`n-${index}`));
		assert.equal(validateGraph({ ...empty(), nodes }).nodes.length, 500);
		assert.equal(validateGraph(completeGraph()).edges.length, 1000);
		for (const field of ["nodes", "edges"] as const) {
			const count = field === "nodes" ? 501 : 1001;
			let reads = 0;
			const values = new Array(count);
			Object.defineProperty(values, "0", {
				enumerable: true,
				get() {
					reads++;
					return node("secret");
				},
			});
			rejects(() => validateGraph({ ...empty(), [field]: values }));
			assert.equal(reads, 0);
		}
	});

	test("one MiB input boundary is checked before parsing and includes whitespace", () => {
		const base = JSON.stringify(empty());
		const exact = " ".repeat(GRAPH_LIMITS.maxBytes - base.length) + base;
		assert.equal(Buffer.byteLength(exact, "utf8"), GRAPH_LIMITS.maxBytes);
		assert.deepEqual(parseGraph(exact), empty());
		rejects(() => parseGraph(` ${exact}`));
	});

	test("the budget counts UTF-8 bytes rather than code units for raw and object input", () => {
		const input = {
			...empty(),
			nodes: Array.from({ length: 500 }, (_, index) =>
				node(`n-${index}`, "中".repeat(1000)),
			),
		};
		const serialized = JSON.stringify(input);
		assert.ok(serialized.length < GRAPH_LIMITS.maxBytes);
		assert.ok(Buffer.byteLength(serialized, "utf8") > GRAPH_LIMITS.maxBytes);
		rejects(() => parseGraph(serialized));
		rejects(() => validateGraph(input));
		const fourByte = {
			...empty(),
			nodes: Array.from({ length: 500 }, (_, index) =>
				node(`n-${index}`, "🦊".repeat(500)),
			),
		};
		assert.ok(
			Buffer.byteLength(JSON.stringify(fourByte), "utf8") <
				GRAPH_LIMITS.maxBytes,
		);
		assert.deepEqual(parseGraph(serializeGraph(fourByte)), fourByte);
	});

	test("HTML-safe expansion cannot produce an unimportable oversized export", () => {
		const input = {
			...empty(),
			nodes: Array.from({ length: 200 }, (_, index) =>
				node(`n-${index}`, "<".repeat(1000)),
			),
		};
		assert.deepEqual(validateGraph(input), input);
		rejects(() => serializeGraph(input));
	});
});

describe("connection integrity and atomic helpers", () => {
	test("duplicate node, edge and cross-kind identifiers fail", () => {
		for (const input of [
			{ ...empty(), nodes: [node("a"), node("a")] },
			{ ...fixture(), edges: [edge("same", "a", "b"), edge("same", "b", "c")] },
			{ ...fixture(), edges: [edge("a", "a", "b")] },
		])
			rejects(() => validateGraph(input));
	});

	test("dangling endpoints, self edges and duplicate directed endpoint pairs fail", () => {
		for (const edges of [
			[edge("e", "missing", "a")],
			[edge("e", "a", "missing")],
			[edge("e", "a", "a")],
			[edge("e1", "a", "b"), edge("e2", "a", "b")],
		])
			rejects(() => validateGraph({ ...fixture(), edges }));
	});

	test("reverse-direction edges and longer cycles are valid", () => {
		const cyclic = {
			...fixture(),
			edges: [...fixture().edges, edge("ca", "c", "a"), edge("ba", "b", "a")],
		};
		assert.deepEqual(validateGraph(cyclic), cyclic);
	});

	test("arbitrary IDs cannot collide through delimiter joining or prototype lookup", () => {
		const input = {
			...empty(),
			nodes: [
				node("a->b"),
				node("c"),
				node("a"),
				node("b->c"),
				node("__proto__"),
				node("constructor"),
			],
			edges: [
				edge("e1", "a->b", "c"),
				edge("e2", "a", "b->c"),
				edge("prototype", "__proto__", "constructor"),
			],
		};
		assert.deepEqual(parseGraph(serializeGraph(input)), input);
	});

	test("proposing a connection returns a fresh graph and preserves its inputs", () => {
		const input = fixture();
		const before = structuredClone(input);
		const candidate = edge("ca", "c", "a");
		const result = proposeConnection(input, candidate);
		assert.deepEqual(input, before);
		assert.equal(result.edges.length, 3);
		assert.deepEqual(result.edges[2], candidate);
		assert.notEqual(result.edges[2], candidate);
		assert.notEqual(result.nodes[0].position, input.nodes[0].position);
		assert.notEqual(result.viewport, input.viewport);
	});

	test("invalid proposals never call the narrowing policy or change the original", () => {
		const input = fixture();
		const before = structuredClone(input);
		let calls = 0;
		for (const candidate of [
			edge("ab", "c", "a"),
			edge("a", "c", "a"),
			edge("e", "a", "b"),
			edge("e", "a", "a"),
			edge("e", "a", "missing"),
		]) {
			rejects(() =>
				proposeConnection(input, candidate, () => {
					calls++;
					return true;
				}),
			);
			assert.deepEqual(input, before);
		}
		assert.equal(calls, 0);
		rejects(() =>
			proposeConnection(completeGraph(), edge("new", "node-39", "node-38")),
		);
	});

	test("a policy receives the edge and a frozen pre-proposal snapshot", () => {
		const input = fixture();
		let calls = 0;
		const result = proposeConnection(
			input,
			edge("ca", "c", "a"),
			(candidate, graph) => {
				calls++;
				assert.equal(candidate.id, "ca");
				assert.equal(graph.edges.length, 2);
				assert.notEqual(graph, input);
				for (const value of [
					candidate,
					graph,
					graph.nodes,
					graph.nodes[0],
					graph.nodes[0].position,
					graph.edges,
					graph.edges[0],
					graph.viewport,
				]) {
					assert.equal(Object.isFrozen(value), true);
				}
				return candidate.source === "c";
			},
		);
		assert.equal(calls, 1);
		assert.equal(result.edges.length, 3);
		assert.equal(Object.isFrozen(result), false);
		assert.equal(Object.isFrozen(result.nodes[0]), false);
	});

	test("policy rejection, throws, mutations, async and truthy results fail safely", () => {
		const input = fixture();
		const before = structuredClone(input);
		const policies: unknown[] = [
			() => false,
			() => {
				throw new Error("secret-input");
			},
			(_candidate: GraphEdge, graph: GraphDocument) => {
				graph.nodes[0].label = "secret-input";
				return true;
			},
			(candidate: GraphEdge) => {
				candidate.target = "secret-input";
				return true;
			},
			async () => true,
			() => "true",
			() => ({}),
			true,
			null,
		];
		for (const policy of policies) {
			rejects(() =>
				proposeConnection(
					input,
					edge("ca", "c", "a"),
					policy as ConnectionPolicy,
				),
			);
			assert.deepEqual(input, before);
		}
	});

	test("deletion removes every incident edge atomically and preserves unrelated data", () => {
		const input = {
			...fixture(),
			edges: [...fixture().edges, edge("ca", "c", "a")],
		};
		const before = structuredClone(input);
		const result = deleteGraphNode(input, "b");
		assert.deepEqual(
			result.nodes.map((node) => node.id),
			["a", "c"],
		);
		assert.deepEqual(result.edges, [edge("ca", "c", "a")]);
		assert.deepEqual(result.viewport, input.viewport);
		assert.deepEqual(input, before);
		assert.notEqual(result.nodes[0], input.nodes[0]);
		assert.deepEqual(validateGraph(result), result);
	});

	test("unknown node deletion is a detached no-op; invalid IDs and invalid graphs fail", () => {
		const input = fixture();
		const result = deleteGraphNode(input, "unknown");
		assert.deepEqual(result, input);
		assert.notEqual(result, input);
		assert.notEqual(result.nodes[0], input.nodes[0]);
		for (const id of ["", "i".repeat(129), "\r", "\0", "\ud800"]) {
			rejects(() => deleteGraphNode(input, id));
		}
		const invalid = { ...fixture(), edges: [edge("dangling", "a", "missing")] };
		rejects(() => deleteGraphNode(invalid, "a"));
		rejects(() => proposeConnection(invalid, edge("ca", "c", "a")));
	});
});
