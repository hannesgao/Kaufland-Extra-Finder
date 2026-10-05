# Frontend fixtures

`extra.json` is a **sample** in the `extra.json` schema (v1) for development and tests. Store ids,
names, addresses and coordinates are real (Kaufland store list, 2026-10-05); leaflet ids, URLs,
clusters and the special opening days are made up to cover these cases:

- a cluster shared by several stores (Karlsruhe area),
- a store with the current _and_ next week's leaflet (Kassel-Wesertor),
- a closure day and shortened hours inside the validity period (Karlsruhe-Grünwinkel).

The dev server shifts all dates by whole weeks so the sample always looks current.
