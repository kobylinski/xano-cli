workspace helloworld {
}
---
// api group comment
api_group hello {
  canonical = "hello"
}
---
query world verb=GET {
  api_group = "hello"
  input {
  }

  stack {
  }

  response = "hi there"
}
