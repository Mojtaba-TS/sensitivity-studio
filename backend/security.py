from __future__ import annotations

import ast

from fastapi import HTTPException


MAX_CODE_BYTES = 100_000
MAX_AST_NODES = 12_000
MAX_LITERAL_ITEMS = 5_000
ALLOWED_IMPORTS = {"pyomo.environ"}

BANNED_CALLS = {
    "DataPortal",
    "ExternalFunction",
    "SolverFactory",
    "__import__",
    "breakpoint",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "exit",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "object",
    "open",
    "quit",
    "setattr",
    "super",
    "type",
    "vars",
}

BANNED_METHODS = {
    "connect",
    "DataPortal",
    "dump",
    "dumps",
    "fromfile",
    "load",
    "loads",
    "popen",
    "read",
    "request",
    "run",
    "save",
    "SolverFactory",
    "system",
    "tofile",
    "urlopen",
    "write",
}

BANNED_NODES = (
    ast.AsyncFor,
    ast.AsyncFunctionDef,
    ast.AsyncWith,
    ast.Await,
    ast.ClassDef,
    ast.Global,
    ast.Nonlocal,
    ast.Try,
    ast.With,
    ast.While,
    ast.Yield,
    ast.YieldFrom,
)


def _reject(message: str) -> None:
    raise HTTPException(status_code=422, detail=f"Model code rejected: {message}")


def validate_model_code(code: str) -> None:
    encoded = code.encode("utf-8")
    if len(encoded) > MAX_CODE_BYTES:
        _reject(f"code exceeds the {MAX_CODE_BYTES // 1000} KB limit")

    try:
        tree = ast.parse(code, filename="model.py", mode="exec")
    except SyntaxError as error:
        _reject(f"invalid Python syntax at line {error.lineno}: {error.msg}")

    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        _reject("model structure is too large")

    for node in nodes:
        if isinstance(node, BANNED_NODES):
            _reject(f"{type(node).__name__} statements are not allowed")

        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    _reject(f"import '{alias.name}' is not allowed; use pyomo.environ only")

        if isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_IMPORTS:
                _reject(f"import from '{node.module or 'relative module'}' is not allowed; use pyomo.environ only")

        if isinstance(node, ast.Name) and node.id.startswith("__"):
            _reject("dunder names are not allowed")

        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            _reject("dunder attributes are not allowed")

        if isinstance(node, (ast.List, ast.Tuple, ast.Set)) and len(node.elts) > MAX_LITERAL_ITEMS:
            _reject("a collection literal is too large")

        if isinstance(node, ast.Dict) and len(node.keys) > MAX_LITERAL_ITEMS:
            _reject("a dictionary literal is too large")

        if isinstance(node, ast.Constant):
            if isinstance(node.value, str) and len(node.value) > MAX_CODE_BYTES:
                _reject("a string literal is too large")
            if isinstance(node.value, int) and abs(node.value) > 10**15:
                _reject("an integer literal is too large")

        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            _reject("power expressions are not supported; submit a linear LP or MILP model")

        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in BANNED_CALLS:
                _reject(f"call to '{node.func.id}' is not allowed")
            if isinstance(node.func, ast.Attribute) and node.func.attr in BANNED_METHODS:
                _reject(f"call to method '{node.func.attr}' is not allowed")
