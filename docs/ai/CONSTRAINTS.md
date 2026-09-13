# Constraints

The AI must never:
- Touch <module> without explicit approval
- Add a dependency without asking
- Modify migrations, secrets, or CI config
- Change public API signatures
- Refactor code outside the scope of the current request
- Delete tests to make a build pass

The AI must always:
- Use <pattern> for data access
- Write tests for new branching logic
- Keep changes under ~<N> files per request

