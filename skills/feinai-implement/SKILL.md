---
name: feinai-implement
description: Use when a feinai task needs to be executed. Claims one pending task from feinai, implements it in an isolated worktree, runs quality gates, and pushes to main. Designed to be dispatched by feinai-dispatch or run standalone for a single task.
---

# feinai-implement

Claim one pending task from feinai, implement it in an isolated worktree, run quality gates, push to main.

## Preconditions

1. `feinai status` succeeds and there is at least one pending task
2. Current working directory is a clean git repo
3. `feinai git status` works (feinai git is bundled with feinai — no separate setup needed)

If any fails: stop and report. Do not improvise.

---

## AL ARRANCAR

1. `feinai list --pending --json` — encontrá la primera tarea disponible (sin blockers pendientes)
2. Si no hay ninguna → respondé "No hay tareas pendientes" y pará
3. `feinai take <TASK-ID> --owner implement-agent` — tomala atómicamente
4. Si la tarea tiene `spec_id` → `feinai spec content <SPEC-ID>` para contexto
5. Si la tarea tiene `blocked_by` con tareas no completadas → soltá con `feinai release <TASK-ID>` y pará

Leé `AGENTS.md` del proyecto para arquitectura y convenciones del proyecto específico.

---

## Ejecutar la tarea

**Paso 1 — Worktree aislado:**
```bash
feinai git worktree add .worktrees/<TASK-ID> origin/main
cd .worktrees/<TASK-ID>
```

**Paso 2 — Setup del worktree:**
Instalá dependencias si el proyecto las requiere. Consultá `AGENTS.md` del proyecto para el comando exacto.

**Paso 3 — Leer antes de escribir:**
- La descripción completa de la tarea (`feinai show <TASK-ID>`)
- Los archivos que vas a tocar — léelos antes de editarlos
- Si hay un **Workplan** en la descripción → ejecutá esos pasos en ese orden exacto

**Paso 4 — Implementar:**
Exactamente lo que dice la tarea. Ni más ni menos.
- No toques archivos fuera del scope de la tarea
- Si un archivo "a crear" ya existe → extendelo en lugar de sobrescribirlo si ya tiene contenido válido

**Paso 5 — Commit:**
Un commit por tarea. Conventional commits:
```
feat(scope): descripción concisa
```
Tipos: `feat`, `fix`, `refactor`, `test`, `chore`.

**Paso 6 — Quality gates:**
Corré los gates definidos en la tarea (`quality_gates`). Si la tarea no los especifica, consultá `AGENTS.md` del proyecto para los gates por defecto.

**Paso 7 — Cerrar:**

Gates pasan:
```bash
# Desde el worktree:
feinai git push origin HEAD:main

# Desde la raíz del repo:
feinai git worktree remove .worktrees/<TASK-ID>
feinai git complete

feinai done <TASK-ID> --result "gates ✓"
```

Gates fallan → seguí "Si algo falla".

**Done = 3 hechos observables:**
1. Quality gates pasan sin errores
2. Los archivos de la tarea existen con contenido correcto
3. Commit limpio en `main` y tarea en estado `completed` en feinai

---

## Si algo falla

Gates fallan, push falla, o error en cualquier paso:

1. **No limpies el worktree**
2. Push a rama backup:
   ```bash
   feinai git push origin HEAD:backup/<TASK-ID>
   ```
3. Marcá la tarea como fallida:
   ```bash
   feinai fail <TASK-ID> --error "<comando exacto + output relevante>"
   ```
4. Dejá el worktree intacto para recuperación manual

---

## Git — `feinai git` exclusivamente

`git` y `gh` están bloqueados. Usá `feinai git` para todo — es opengit bundleado con feinai.

**Permitido:**
- `feinai git worktree add/list/lock/unlock`
- `feinai git add`, `commit`, `push`, `status`, `diff`, `log`, `show`
- `feinai git complete` — sincroniza main local tras push (solo desde raíz del repo)

**Prohibido:**
- `feinai git branch`, `checkout`, `switch` — nunca cambiar branches
- `feinai git merge`, `rebase`, `reset`, `cherry-pick`
- `feinai git fetch`, `pull`, `remote`, `clone`
- `feinai git stash`, `tag`
- `feinai git worktree remove` — solo tras push exitoso

Si `feinai git` falla → **STOP**. No reintentes, no uses `git`. Reportá al usuario.

---

## Reglas absolutas

**No modifiques:**
- `AGENTS.md`, `CLAUDE.md`
- Archivos de configuración de CI/CD, infra, o secretos (`.env`, `.env.*`)
- La DB de feinai directamente

**Código:**
- Sin `any` sin comentario justificado en la misma línea
- Si un test falla: corregí el test O la implementación. Nunca silencies, skipees, ni agregues workarounds para que el gate "pase"
- Si no es obvio cuál es la causa → **STOP**, reportá al usuario con el comando exacto y el output completo
