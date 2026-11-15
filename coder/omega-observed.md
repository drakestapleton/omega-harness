
- `struct` definitions come before the first `fn`; a `struct` after a function is error 9.
- `global`, `const` and `text` may appear between functions.
- An `if` with an `else` arm: `if COND` ... `else` ... `end`. There is no `elif`, and writing one is not
  refused: a line `NAME VALUE` is an assignment, so `elif lt x 5` compiles as a new local named `elif` and
  the line after it runs whenever the `if` arm runs (no diagnostic, wrong branch). Nest a second `if` inside
  the `else` arm instead.
