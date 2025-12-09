workspace job-inputs {
}
---
function $main {
  input {
    json args
    json pre
  }

  stack {
  }

  response = $input.args
}