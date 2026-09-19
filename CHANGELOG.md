# Changelog

## 0.1.0

- Compare committed JS/TS module references using Git object reads and the
  TypeScript compiler API, without checkout or execution of repository code.
- Track static imports, re-exports, literal require and dynamic import syntax;
  expose unresolved, computed, shadowed and external references.
- Add offline interactive HTML with graph navigation, source evidence,
  revision filters, potential dependent paths, coverage, and JSON export.
- Add resource limits, bounded source excerpts, cyclic-group comparison,
  synthetic two-commit demo generation, and regression tests.
