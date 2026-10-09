# Compiler Reference for `"use agent"`

Read this when a compiled agent fails to build, or when it builds and then
misbehaves after a suspension. It is a lookup table, not a chapter — find the
symptom, apply the fix.

Code agents with automatic state management use the `"use agent"` directive.
This triggers a Babel compiler (`@guildai/babel-plugin-agent-compiler`) that
translates each `async` function into a serializable state machine — the
agent's entire execution state can be captured at any `await`, persisted to
storage, and resumed hours or days later.

The compiler supports most JavaScript, but some constructs either fail at build
time or — more dangerously — compile cleanly and then silently produce wrong
behavior across an `await`. This document enumerates both, plus a few
constructs that look risky and are in fact supported.

These limitations apply **only to code inside a `"use agent"` function body**.
`llmAgent` agents and self-managed-state agents are not compiled and have none
of these restrictions.

**Concurrency is not on this list.** Compiled agents fan out with
`task.gather` / `task.gatherSettled`; see the main SKILL.md. Nothing here is a
reason to split work across two agents.

## Fails at build time

The compiler throws `NotImplemented` and `npm run build` fails. Fix the source.

### Async generators

```typescript
// ❌ NotImplemented: async generator function
async function* stream() { ... }
```

There is no workaround in compiled code — restructure to a regular async
function that returns a batch, or accumulate results imperatively.

### Labeled `break` / `continue`

```typescript
// ❌ NotImplemented: break to label / continue to label
outer: for (...) {
  for (...) { break outer }
}
```

Refactor to a boolean flag, an early `return`, or extract the inner loop to a
helper that signals via its return value.

### Two nested functions sharing a name

Non-async nested functions are hoisted to closure level by name, so two
declarations of the same name in sibling scopes cannot both survive.

```typescript
// ❌ NotImplemented: function name collision
{
  function bar() { ... }
  bar()
}
{
  function bar() { ... }
  bar()
}
```

Give each helper a unique name. The thrown error reports `position undefined`
rather than pointing at the offending declaration, so grep the agent for
duplicated nested function names.

## Compiles cleanly, fails at runtime

These compile cleanly. If the agent never suspends (no `task.save()` /
`ui_prompt` / external tool that takes time), they may even appear to work in
testing. But once the state machine is serialized at the `await` and later
resumed, behavior is wrong. **The compiler does not warn you.**

Rule of thumb: anything stored in a local variable that crosses an `await`
must be JSON-serializable via `@guildai/s11n`. `s11n` natively handles
primitives, plain objects, arrays, `Map`, `Set`, `Date`, plain `Error`, cycles
and shared references. Everything else is suspect.

### A `Promise` held in a local across an `await`

A promise is not serializable. The hazard is holding one in a **local variable
that crosses a suspend point** — that variable lives in a frame slot, and the
frame cannot be restored.

```typescript
// ❌ `p` is in a frame slot at the `await delay()`
const p = fetchSomething();
await delay();
return await p;
```

Composition itself is fine. `Promise.all` / `.allSettled` / `.race` / `.any`
work when the promise is created and consumed within a single expression,
because nothing promise-valued ever occupies a frame slot across a suspend:

```typescript
// ✅ created and awaited in one expression
const [a, b] = await Promise.all([fetchA(), fetchB()]);
const winner = await Promise.race([f1(), f2()]);
```

Two caveats on that:

- If the operands are calls to `async` functions in the agent's own module,
  the compiler rewrites them into state-machine calls that run **one after
  another** — correct results, no concurrency. `Promise.all` buys you nothing
  there.
- **Tool calls are different.** `Promise.all` over `task.tools.X(...)` is not
  supported: it hides the tool-call promises inside a plain promise, so the
  runtime never sees them and never suspends to dispatch them. **Use
  `task.gather` / `task.gatherSettled` instead** — they are the
  compiler-supported replacement when every input is a tool call, and unlike
  `Promise.all` they genuinely run concurrently. See SKILL.md.

**Workaround for the held-promise case:** await each promise where you create
it, and cross the `await` with the resolved value rather than the promise.

```typescript
// ✅
const a = await fetchA();
const b = await fetchB();
```

The failure is not diagnosable from the error message, so recognize the two
signatures:

| Path                     | Error                                          |
| ------------------------ | ---------------------------------------------- |
| State was serialized     | `SerializationError: Cannot serialize Promise` |
| State was not serialized | `ReferenceError: p is not defined`             |

The `ReferenceError` names a variable that plainly exists in your source. It
means the frame slot holding that promise did not come back — not that you
misspelled anything.

### `for await ... of` and async iterators

```typescript
// ❌ The `await` is silently dropped
for await (const item of asyncIterable) { ... }
```

The compiler emits a plain `for-of` loop, so each `item` is the unresolved
Promise rather than its value, and any iterator-protocol `await`s are skipped.
The build does not warn.

If the data source can be enumerated synchronously, use `for-of` and `await`
each item explicitly. If the source is genuinely streaming, you cannot consume
it from a compiled agent — fetch the data in a non-compiled helper or pre-load
into an array.

### Externally-produced function values across `await`

Inline arrow / function expressions written directly in your source are
hoisted into a `$fns` array and survive serialization. **Function values that
arrive from outside the compiled source do not** — the compiler has no body to
hoist.

```typescript
// ❌ Function received as a parameter
async function run(callback: () => void) {
  'use agent';
  await delay();
  callback(); // undefined after restore
}

// ❌ Function returned from a non-compiled call
const f = makeAdder(x);
await delay();
return f(1); // undefined after restore

// ❌ Imported / module-level function stored in a frame slot
import { uncompiled } from './helpers';
const h = { fn: uncompiled };
await delay();
return h.fn(x); // undefined after restore

// ❌ Functions produced by .map / Object.assign / spread
const fns = items.map((i) => () => process(i));
await delay();
return fns[0](); // undefined after restore
```

**Workarounds:**

1. Wrap module-level or imported functions in an inline arrow. The arrow is a
   literal the compiler can hoist; the body resolves the external name at call
   time:
   ```typescript
   const f = (n: number) => uncompiled(n); // ✅
   const h = { fn: (n: number) => uncompiled(n) }; // ✅
   ```
2. Inline factory logic at the call site rather than going through a factory
   that returns a function value:
   ```typescript
   const f = (n: number) => x + n; // ✅ instead of makeAdder(x)
   ```
3. Persist the data, not the functions. Cross the `await` with the inputs and
   construct functions just-in-time on the synchronous side.
4. Replace a callback parameter with a tagged-dispatch enum. Wrapping a
   parameter callback in an inline arrow does **not** help — the parameter
   itself is in a frame slot:
   ```typescript
   async function run(strategy: 'upper' | 'lower', text: string) {
     'use agent';
     await delay();
     return strategy === 'upper' ? text.toUpperCase() : text.toLowerCase();
   }
   ```
5. If you cannot eliminate a callback, call it before any `await` and store
   only its result.

### Lookup tables cannot call compiled async functions

An inline arrow can safely wrap an imported or module-level function only when
the name inside the arrow still resolves at runtime. Compiled `async` functions
in the module have no runtime binding left — only `run` survives — so an arrow
that names one throws `ReferenceError` on first call:

```typescript
async function applyThing(a: Arg) {
  /* compiled away */
}
const table = { [NAME]: (a: Arg) => applyThing(a) }; // ❌ ReferenceError
```

Nothing catches this: `tsc`, Babel, and esbuild all pass, the bundle is valid,
and the version publishes. Dispatch to a compiled async function must be a
statically named call — use `switch` or `if` on the tag and call
`applyThing(a)` directly rather than looking it up in a table.

### MemberExpression call of a compiled async in an object or array

Async arrow and async function expressions compile into the state machine as
**call descriptors** stored in a closure-level `$fns` array — they invoke
correctly when called via a plain identifier callee. Calling one via member
access (`obj.fn()`, `arr[i]()`) goes through a different code path that the
compiler does not yet rewrite, so JavaScript invokes the descriptor's throw
stub directly: `compiled async function called from outside the state machine`.

```typescript
// ❌ Runtime throw
const handlers = {
  onClick: async (x: number) => {
    await delay();
    return x + 1;
  },
};
return await handlers.onClick(5);

// ❌ Same shape
const fns = [async (x: number) => x + 1];
return await fns[0](5);

// ✅ Extract to a local Identifier first
const fn = handlers.onClick;
return await fn(5);
```

### `new` on a compiled async function

Calling `new` on a compiled async expression dispatches through a code path
the compiler does not rewrite, so JavaScript invokes the descriptor's throw
stub. This is unusual code — just don't.

### Descriptor leaks to non-compiled JavaScript

A compiled async expression that escapes into non-compiled JS — passed as a
callback to `.map`, `setTimeout`, `Promise.all`, etc. — gets invoked as a
plain function and throws. The error message includes the source location of
the original async expression so leaks are diagnosable.

```typescript
// ❌ .map invokes the descriptor directly → throws
const results = items.map(async (x) => task.tools.http_get({ url: x }))

// ❌ setTimeout schedules the descriptor as a plain callback
setTimeout(async () => { ... }, 1000)

// ❌ .map has already produced descriptors by the time Promise.all sees them
await Promise.all(items.map(async (x) => task.tools.http_get({ url: x })))
```

What leaks is the async expression itself, not the composition around it.
`Promise.all([asyncFn(), otherAsync()])` — direct calls to `async` functions
in the same module — does not leak, because the compiler rewrites those calls
into the state machine (sequentially; see the promise limitation above).

**Workaround:** build the array of tool calls with a plain `for` loop and pass
it to `task.gather` — that is the supported way to run this work concurrently.

```typescript
// ✅
const calls = [];
for (const x of items) calls.push(task.tools.http_get({ url: x }));
const results = await task.gather(calls);
```

### Other non-serializable values across `await`

The following are not serializable; storing them in a local that crosses an
`await` will produce wrong behavior after restore:

- `Promise` (see above)
- `RegExp`
- `WeakMap`, `WeakSet`
- Class instances (`new Foo(...)` for any user-defined class)
- Arbitrary external functions (see above)

Keep these inside a single step. If you must cross an `await`, store the data
needed to reconstruct them (the regex source string, the constructor args)
and rebuild on the other side.

## `try` / `catch` around a tool call works

A rejected tool call is delivered to the innermost enclosing `catch` clause in
compiled code, and execution continues past it — so an agent can retry, fall
back, or degrade around a failing call. It is called out here because it is
the natural thing to reach for when a tool call can fail, and nothing else in
this list says whether it is safe.

```typescript
let pulls;
try {
  pulls = await task.tools.github_pulls_list({ owner, repo, state: 'open' });
} catch (exc) {
  task.console.warn(`listing PRs failed, continuing without them: ${exc}`);
  pulls = [];
}
```

## Module and dependency limits

### No imports from local modules

The compiler only processes the file containing the agent. Async helpers in
sibling `.ts` files are not compiled into the state machine and will not
survive serialization.

```typescript
// ❌ Async helper imported from another file
import { fetchAndProcess } from './helpers';
// fetchAndProcess will run, but if it suspends, its frame is lost
```

Keep all code that crosses `await` in the same file as the agent. Pure-sync
helpers can live elsewhere as long as the values they return are serializable.

### CJS / native modules cannot be used

Agent code runs in an ESM-only sandbox. Adding a CommonJS package to
`dependencies` will fail at runtime. Verify each dependency is ESM-compatible
before adding it (`"type": "module"` in its `package.json`, or shipped as
`.mjs`).

### No source maps

The compiled state machine has no source-map relationship to your TypeScript
source. Runtime stack traces point into the generated `switch ($step)
{ ... }`. When debugging, reproduce in a small standalone test and read the
generated code if you must — `npx babel agent.js --plugins
@guildai/babel-plugin-agent-compiler` will print the transformed output.

## Keep heavy work in synchronous helpers, not async ones

The `"use agent"` directive makes the compiler translate **every asynchronous
function in the agent's module** — the `run` body and any `async` function it
nests or calls within the same file — into state-machine steps. It does
**not** translate **synchronous** functions (those are hoisted and left as
ordinary JavaScript), and it never touches code in other files. So the lever
for heavy _pure_ computation is simple: **make it a synchronous function.** The
async/sync distinction is what matters here, not where the function lives.

A synchronous call runs to completion within a single step of its caller,
which has two payoffs:

1. **Nothing extra is serialized.** A sync helper isn't compiled at all — it's
   hoisted to the closure as an ordinary function and runs inside its caller's
   current step, so its intermediates — a 5,000-element array, a large `Map` —
   are plain JS locals that never enter `$frames` and so are never serialized.
   (What _is_ captured at each `await` is the live frame stack of the compiled
   code.) Mark that same helper `async` and it becomes part of the state
   machine: its locals move into frame slots and serialize at every suspension
   like everything else.

2. **It runs as plain JS, and it can't blow the step budget.** Compiled code
   is native JavaScript, but the compiler lowers every loop into numbered
   state-machine steps and each iteration costs one metered step against a
   budget (1,000 per refill). A genuine `await` resets the meter, but a tight
   compiled loop never yields — so a few thousand iterations of pure arithmetic
   exhaust the budget repeatedly, and after a fixed number of refills without
   yielding (10 by default, i.e. ~10,000 steps) the runtime **stops the agent**
   with "Agent ran too many synchronous steps without yielding." A sync helper
   sidesteps this entirely: it runs as one ordinary native loop, off the meter.

Keep `run()` a thin **orchestrator** — tool calls, `task.gather`, control flow
— and push date parsing, bucketing, aggregation, statistics, and large-array
assembly into **synchronous** helpers (module scope is the natural home):

```typescript
// ✅ run() awaits I/O; the heavy loop is a plain sync function
const calls = [];
for (const w of workflows) calls.push(listRuns(w.id, 1)); // compiled: 1 step/item
const pages = await task.gather(calls);
const { skipped, regressed } = analyzeRuns(pages, cfg); // sync → not compiled

// ❌ marking the same helper async pulls it into the state machine — its big
//    intermediates now serialize at every await, for no benefit
async function analyzeRuns(pages, cfg) {
  /* parse dates, bucket, median... */
}
```

Note that `run()`'s own loops are compiled too: the `for` above spends one step
per workflow against the budget. That's fine for tens or hundreds of items, but
if the orchestrator itself iterates over thousands, move that loop into a sync
helper as well — the budget doesn't care whether a loop is "setup" or "work."

The sync helpers are also independently unit-testable, since they never touch
`task` — and per the local-modules rule above, a pure-sync helper may even
live in another file, as long as the value it returns is serializable.

(This applies only to compiled `"use agent"` agents. Self-managed-state agents
— the `start` / `onToolResults` pattern — have no directive and aren't compiled
at all.)
