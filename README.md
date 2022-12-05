# fetch() extension

Extension of [native fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) with:

* Retryable requests
* Request timeout
* Standalone HTTP utilities

## `options.extension`

* **`timeout` Number | String**

  Request timeout

* **`retry` Object**
  - **`limit` Number**

    Default: 1
  - **`methods`[String]**

    Default: [DELETE, GET, HEAD, PATCH, PUT]
  - **`delay` Number | String**

    Default: 100

## `response.extension`

* **`body()`**

  Infer and execute body parser based on `content-type`
