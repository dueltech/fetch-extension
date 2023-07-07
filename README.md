# fetch() extension

Extension of [native fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) with:

* Retryable requests
* Request timeout
* Standalone HTTP utilities

## `options.extension`

* **`timeout` number | string**

  Request timeout

* **`retry` Object**
  - **`limit` Number**

    Default: 1
  - **`methods`[String]**

    Default: [DELETE, GET, HEAD, PATCH, PUT]
  - **`delay` Number | String**

    Default: 100

* **`json` any**

  Shortcut for sending JSON serialized data. Equivalent to:
  ```
  {
      headers: {
          'content-type': 'application/json',
          'accept':  'application/json',
      },
      body: JSON.stringify(value),
  }
  ```

## `response.extension`

* **`body()`**

  Infer and execute body parser based on `content-type`
