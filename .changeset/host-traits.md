---
"nbridge": patch
---

Add **traits** to Host Rules: match capabilities and variants on dimensions beyond `(platform, version)`.

A trait is a named string dimension with its own pluggable source, e.g. a `?mk=` marketing channel. Declare traits in `defineHostRules({ traits })` and match them in a rule's `when`:

```ts
const host = defineHostRules({
  traits: {
    // Declare `values` to type-check them in rules (a typo is a compile error).
    mk: { source: traitFromQuery("mk"), values: ["google", "bing"] as const },
  },
  capabilities: {
    // `when` adds a trait gate ANDed on top of the per-platform rule.
    promoBanner: { web: true, when: { traits: { mk: "google" } } },
  },
  variants: {
    saveFlow: {
      rules: [
        { when: { traits: { mk: "google" } }, use: "A" },
        { when: { traits: { mk: ["bing", "duckduckgo"] } }, use: "B" }, // array = one of
      ],
      default: "A",
    },
  },
});
```

New and extended APIs (all additive, no breaking changes):

- `traits` config key; the `traitFromQuery(param, { storageKey?, persist? })` built-in source (persists to `sessionStorage` by default, like `versionFromQuery`); `HostTraitSource` and `TraitDef` types.
- `when` gains an optional `traits` clause on variant rules, and capabilities gain an optional `when` trait gate. Trait matching is equality, an array is "one of", and multiple `when` conditions AND together.
- `host.setTrait(name, value)` for async acquisition (the trait counterpart of `setVersion`), and `useTrait(name)` from `createHostHooks`.
- Unknown traits are conservative, exactly like an unknown version: a rule or capability that requires an absent trait does not match, so the React server snapshot stays consistent and hydration never mismatches.
- The DevTools **Host** tab shows resolved traits and adds trait override controls (a dropdown when the trait declares `values`).

Trait values are typed from the config: declare `values` for a compile-checked domain, or omit it for open-ended strings.
