# SalesPark API Client - Generic HTTP Wrapper v1 - Documentation

## @salespark/api-client

Generic HTTP client wrapper built on top of Axios that guarantees consistent `{ status: boolean, data: any }` responses and never throws exceptions. Includes automatic retries with exponential backoff, request cancellation, upload/download helpers, and CRUD sugar via resource helpers.

---

## 📦 Installation

```bash
yarn add @salespark/api-client
# or
npm install @salespark/api-client
```

## 🚀 Key Features

- ✅ **Consistent Response Format** - Always returns `{ status: boolean, data }`
- ✅ **Never Throws** - All errors are normalized to the same response format
- ✅ **Automatic Retries** - Exponential backoff with jitter for server errors
- ✅ **Request Cancellation** - Full support for AbortController/AbortSignal
- ✅ **Upload/Download Helpers** - File uploads with progress and blob downloads
- ✅ **CRUD Resource Helper** - Simplified REST operations
- ✅ **Interceptor Hooks** - Custom request/response/error handling

## 🔧 Basic Usage

### Simple HTTP Client

```js
import { withAuth } from "@salespark/api-client";

const api = withAuth({
  baseURL: "https://api.example.com", // Can be set via environment variable REACT_APP_API_URL
  authHeaders: {
    Authorization: "Bearer your-token",
  },
});

api.getOne("/users/123").then((result) => {
  if (result.status) {
    console.log("User:", result.data);
  } else {
    console.error("Error:", result.data.message);
  }
});
```

### Resource Helper (CRUD Operations)

```js
import { resource } from "@salespark/api-client";

const usersApi = resource("/users", {
  baseURL: "https://api.example.com", // Can be set via environment variable REACT_APP_API_URL
  authHeaders: { Authorization: "Bearer token" },
});

usersApi.list({ active: true }).then((res) => console.log(res.data));
usersApi.get(123).then((res) => console.log(res.data));
usersApi.create({ name: "John", email: "john@example.com" });
usersApi.update(123, { name: "Jane" });
usersApi.patch(123, { email: "jane@example.com" });
usersApi.remove(123);
```

## 🔨 API Reference

### Client Configuration

- `baseURL` (string): Base URL for all requests
- `timeout` (number): Request timeout in milliseconds
- `defaultHeaders` (object): Default headers for all requests
- `authHeaders` (object): Authentication headers
- `onAuthError` (function): 401/403 handler
- `onRequest` (function): Request interceptor
- `onResponse` (function): Response interceptor
- `onError` (function): Error interceptor

### HTTP Methods

#### GET Operations

```js
api
  .getMany("/users", {
    params: { page: 1, limit: 10 },
    timeout: 5000,
  })
  .then((result) => console.log(result.data));

api
  .getOne("/users/123", {
    headers: { "Custom-Header": "value" },
  })
  .then((result) => console.log(result.data));
```

#### POST/PUT/PATCH Operations

```js
api.post("/users", {
  name: "John Doe",
  email: "john@example.com",
});

api.put("/users/123", { name: "Jane Doe" });

api.patch("/users/123", { email: "new@email.com" });
```

#### DELETE Operations

```js
api.remove("/users/123");
```

### File Operations

#### File Upload

```js
const fileInput = document.getElementById("file");
const file = fileInput.files[0];

api.upload("/upload", file, {
  fieldName: "document",
  onUploadProgress: (event) => {
    const progress = (event.loaded / event.total) * 100;
    console.log(`Upload progress: ${progress}%`);
  },
});

const formData = new FormData();
formData.append("file", file);
formData.append("description", "Document description");
api.upload("/upload", formData);

api.upload("/upload", {
  file: file,
  userId: "123",
  category: "documents",
});
```

#### File Download

```js
api.download("/files/document.pdf").then((result) => {
  if (result.status) {
    const url = URL.createObjectURL(result.data.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.data.filename || "download";
    link.click();
    URL.revokeObjectURL(url);
  }
});
```

### Request Options

- `params` (object): Query parameters
- `headers` (object): Custom headers
- `signal` (AbortSignal): Request cancellation
- `timeout` (number): Per-request timeout
- `responseType` (string): Response type
- `retry` (object): Retry configuration
- `onUploadProgress` (function): Upload progress callback
- `fieldName` (string): Form field name for file uploads

### Retry Configuration

```js
api.getOne("/users/123", {
  retry: {
    retries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitter: true,
  },
});
```

## 📝 Response Format

All methods return a consistent response format:

```js
// Success response
{
  status: true,
  data: { /* your data */ }
}

// Error response
{
  status: false,
  data: {
    message: 'Error message',
    statusCode: 404,
    code: 'ERR_NOT_FOUND',
    // ...other fields
  }
}
```

### Response Handling

```js
api.getOne("/users/123").then((result) => {
  if (result.status) {
    console.log("User:", result.data);
  } else {
    console.error("Error:", result.data.message);
  }
});
```

## 🔄 Advanced Usage

### Request Cancellation

```js
const controller = new AbortController();

const promise = api.getOne("/users/123", {
  signal: controller.signal,
});

setTimeout(() => {
  controller.abort();
}, 5000);

promise.then((result) => {
  if (!result.status) {
    console.error("Request aborted:", result.data.message);
  }
});
```

### Custom Interceptors

```js
const api = withAuth({
  baseURL: "https://api.example.com",
  onRequest: (config) => {
    config.headers = {
      ...config.headers,
      "X-Request-ID": generateRequestId(),
      "X-Timestamp": Date.now().toString(),
    };
    return config;
  },
  onResponse: (response) => {
    console.log("Response from", response.config.url, response.status);
  },
  onAuthError: (error, instance) => {
    console.log("Authentication failed, redirecting to login...");
    window.location.href = "/login";
  },
  onError: (error) => {
    console.error("API Error:", error.message);
  },
});
```

### Environment-Based Configuration

```js
const api = withAuth({
  baseURL: "https://api.example.com", // Can be set via environment variable REACT_APP_API_URL
  authHeaders: {
    Authorization: `Bearer ${getToken()}`,
  },
});
```

### Resource Helper Advanced Usage

```js
const usersApi = resource("/users", {
  baseURL: "https://api.example.com", // Can be set via environment variable REACT_APP_API_URL
  authHeaders: { Authorization: "Bearer token" },
  onError: (error) => {
    console.error("Users API Error:", error);
  },
});

usersApi.list({ active: true, page: 1, limit: 50 }).then((res) => console.log(res.data));
usersApi.action("stats").then((res) => console.log(res.data));
usersApi.action("bulk-update", { ids: [1, 2, 3], status: "active" });
```

## 🧪 Error Handling Patterns

### Basic Error Handling

```js
api.getOne("/users/123").then((result) => {
  if (!result.status) {
    switch (result.data.statusCode) {
      case 404:
        console.log("User not found");
        break;
      case 403:
        console.log("Access denied");
        break;
      case 500:
        console.log("Server error, please try again later");
        break;
      default:
        console.log("Request failed:", result.data.message);
    }
    return;
  }
  console.log("User loaded:", result.data);
});
```

### Async/Await with Error Handling

```js
async function loadUser(id) {
  const result = await api.getOne(`/users/${id}`);
  if (result.status) {
    return result.data;
  }
  console.error("Failed to load user:", {
    message: result.data.message,
    statusCode: result.data.statusCode,
    code: result.data.code,
  });
  return null;
}
```

### Authentication Headers

```js
const api = withAuth({
  authHeaders: {
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  },
});

const apiKeyClient = withAuth({
  authHeaders: {
    "X-API-Key": "your-api-key-here",
  },
});

const customAuthClient = withAuth({
  authHeaders: {
    Authorization: "Custom your-custom-token",
  },
});
```

### Automatic Token Refresh

```js
const api = withAuth({
  authHeaders: {
    Authorization: `Bearer ${getCurrentToken()}`,
  },
  onAuthError: async (error, instance) => {
    try {
      const newToken = await refreshToken();
      instance.defaults.headers["Authorization"] = `Bearer ${newToken}`;
      return instance.request(error.config);
    } catch (refreshError) {
      window.location.href = "/login";
    }
  },
});
```

### Request Optimization

```js
const fastApi = withAuth({ timeout: 5000 });
const slowApi = withAuth({ timeout: 30000 });

fastApi.getOne("/critical-data", {
  retry: {
    retries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
  },
});

slowApi.getOne("/optional-data", {
  retry: { retries: 0 },
});
```

### Cancellation for User Experience

```js
let currentRequest = null;

async function searchUsers(query) {
  if (currentRequest) {
    currentRequest.abort();
  }
  currentRequest = new AbortController();
  const result = await api.getMany("/users/search", {
    params: { q: query },
    signal: currentRequest.signal,
  });
  currentRequest = null;
  return result;
}
```

### Debug Mode

```js
const api = withAuth({
  onRequest: (config) => {
    console.log("🚀 Request:", config.method?.toUpperCase(), config.url, config.data);
    return config;
  },
  onResponse: (response) => {
    console.log("✅ Response:", response.status, response.config.url);
  },
  onError: (error) => {
    console.log("❌ Error:", error.message, error.config?.url);
  },
});
```

---

## 🛠️ Support

Got stuck? Don’t panic — we’ve got you covered.

### 🤖 AI Assistant

We built a custom **AI Assistant** trained _only_ on `@salespark/api-client`.  
It answers implementation and troubleshooting questions in real time:

👉 Ask the API Client GPT:  
https://chatgpt.com/g/g-68a9bafde1c48191b720cd55b6cd4e4a-salespark-api-client-v1

_(Free to use with a ChatGPT account)_

---

### 🔒 Internal Usage Notice

This package is primarily designed and maintained for internal use within the SalesPark ecosystem.
While it can technically be used in other Node.js/Mongoose projects, no official support or guarantees are provided outside of SalesPark-managed projects.

All code follows the same engineering standards applied across the SalesPark platform, ensuring consistency, reliability, and long-term maintainability of our internal systems.

⚡ Note: This package is most efficient and works best when used together with other official SalesPark packages, where interoperability and optimizations are fully leveraged.

Disclaimer: This software is provided “as is”, without warranties of any kind, express or implied. SalesPark shall not be held liable for any issues, damages, or losses arising from its use outside the intended SalesPark environment.

Organization packages: https://www.npmjs.com/org/salespark

---

## 📄 License

MIT © [SalesPark](https://salespark.io)

---

_Document version: 2_  
_Last update: 23-08-2025_
