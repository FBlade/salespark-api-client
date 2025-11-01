# SalesPark API Client - Generic HTTP Wrapper v1 - Documentation

## @salespark/api-client

Generic HTTP client wrapper for browser-based applications (React / Next.js).

---

## 🧭 Overview

`@salespark/api-client` is a lightweight HTTP abstraction built on top of **Axios**, designed to standardize API communication across SalesPark frontend applications.

It enforces a consistent `{ status: boolean, data: any }` (SalesParkContract) response model, never throws exceptions, and includes built‑in retry, cancellation, and upload/download helpers.

This package is part of the **SalesPark Frontend Libraries** and is primarily maintained for internal use in React projects.

---

## 📦 Installation

```bash
yarn add @salespark/api-client
# or
npm install @salespark/api-client
```

---

## 🚀 Core API — withAuth()

The `withAuth()` function creates a fully configured Axios wrapper that handles authorization, retries, and consistent response normalization.

> **Note:** The export `apiClient` is just an alias for `withAuth`, provided for naming convention convenience. Both can be used for public or authenticated APIs; there is no logic difference.

### 📝 Example: Using apiClient for a public API

```ts
import { apiClient } from "@salespark/api-client";

const publicApi = apiClient({ baseURL: "https://jsonplaceholder.typicode.com" });

const posts = await publicApi.getMany("/posts");
if (posts.status) {
  console.log(posts.data);
}
```

### 🔧 Initialization

```ts
import { withAuth } from "@salespark/api-client";

const api = withAuth({
  baseURL: process.env.REACT_APP_API_URL,
  authHeaders: { Authorization: `Bearer ${getToken()}` },
});
```

### ⚙️ Configuration Options

| Option           | Type                        | Description                                   |
| ---------------- | --------------------------- | --------------------------------------------- |
| `baseURL`        | `string`                    | Base URL for all requests                     |
| `authHeaders`    | `Record<string, string>`    | Authorization headers (Bearer, API key, etc.) |
| `defaultHeaders` | `Record<string, string>`    | Headers added to all requests                 |
| `timeout`        | `number`                    | Timeout per request (ms)                      |
| `onAuthError`    | `(error, instance) => void` | Triggered on 401/403 responses                |
| `onRequest`      | `(config) => config`        | Request interceptor                           |
| `onResponse`     | `(response) => void`        | Response interceptor                          |
| `onError`        | `(error) => void`           | Generic error handler                         |

---

## 🧩 Available Methods

All methods return a **Promise** that resolves to:

```ts
{
  status: boolean;
  data: any;
}
```

### 🔹 GET Operations

| Method                    | Description                                 | Example                                          |
| ------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `getOne(path, options?)`  | Fetch a single resource                     | `api.getOne("/users/1")`                         |
| `getMany(path, options?)` | Fetch an array of resources                 | `api.getMany("/users", { params: { page: 1 } })` |
| `get(path, options?)`     | Auto-detects if response is single or array | `api.get("/users/1")`                            |

### 🔹 Write Operations

| Method                        | Description      | Example                                            |
| ----------------------------- | ---------------- | -------------------------------------------------- |
| `post(path, data, options?)`  | Create resource  | `api.post("/users", { name: "John" })`             |
| `put(path, data, options?)`   | Replace resource | `api.put("/users/1", { name: "Jane" })`            |
| `patch(path, data, options?)` | Partial update   | `api.patch("/users/1", { email: "new@mail.com" })` |

### 🔹 Delete Operations

| Method                   | Description          | Example                  |
| ------------------------ | -------------------- | ------------------------ |
| `remove(path, options?)` | Delete resource      | `api.remove("/users/1")` |
| `delete(path, options?)` | Alias for `remove()` | `api.delete("/users/1")` |

### 🔹 File Operations

| Method                                   | Description                       |
| ---------------------------------------- | --------------------------------- |
| `upload(path, fileOrFormData, options?)` | Upload file with progress support |
| `download(path, options?)`               | Download file as Blob             |

---

## 🧠 Example Usage

```ts
// Fetch a user
const user = await api.getOne("/users/42");
if (user.status) console.log(user.data);

// Create a new user
await api.post("/users", { name: "Alice" });

// Update user
await api.patch("/users/42", { name: "Alice Smith" });

// Delete
await api.remove("/users/42");
```

---

## 🔄 Retry and Timeout

Retries are automatically applied for 5xx and network errors.

```ts
await api.getOne("/stats", {
  retry: {
    retries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitter: true,
  },
  timeout: 8000,
});
```

---

## ⏹️ Request Cancellation

```ts
const controller = new AbortController();

const request = api.getMany("/users", { signal: controller.signal });

setTimeout(() => controller.abort(), 2000);
```

When aborted, the result resolves to:

```ts
{ status: false, data: { message: "Request aborted" } }
```

---

## 📤 File Upload

```ts
const file = (document.getElementById("file") as HTMLInputElement).files?.[0];
if (!file) return;

await api.upload("/upload", file, {
  fieldName: "document",
  onUploadProgress: (evt) => {
    console.log(`Progress: ${(evt.loaded / evt.total) * 100}%`);
  },
});
```

With FormData:

```ts
const fd = new FormData();
fd.append("file", file);
fd.append("meta", "invoice");

await api.upload("/files", fd);
```

---

## 📥 File Download

```ts
const res = await api.download("/files/report.pdf");

if (res.status) {
  const blob = res.data.blob;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = res.data.filename || "download";
  link.click();
  URL.revokeObjectURL(url);
}
```

---

## 🧱 Response Model

All methods return normalized responses.

```ts
// Success
{ status: true, data: {...} }

// Error
{ status: false, data: { message, statusCode?, code? } }
```

TypeScript definition:

```ts
type ApiResponse<T> = { status: true; data: T } | { status: false; data: { message: string; statusCode?: number; code?: string } };
```

---

## ⚡ Resource Helper

`resource()` is a convenience wrapper around `withAuth()` for REST endpoints.

```ts
import { resource } from "@salespark/api-client";

const usersApi = resource("/users", {
  baseURL: process.env.REACT_APP_API_URL,
  authHeaders: { Authorization: "Bearer token" },
});

await usersApi.list();
await usersApi.get(42);
await usersApi.create({ name: "John" });
await usersApi.update(42, { name: "Jane" });
await usersApi.remove(42);
```

Supported methods:

| Method                | Maps to                | Description    |
| --------------------- | ---------------------- | -------------- |
| `list(params?)`       | `GET /resource`        | Get many       |
| `get(id)`             | `GET /resource/:id`    | Get one        |
| `create(data)`        | `POST /resource`       | Create         |
| `update(id, data)`    | `PUT /resource/:id`    | Update         |
| `patch(id, data)`     | `PATCH /resource/:id`  | Partial update |
| `remove(id)`          | `DELETE /resource/:id` | Delete         |
| `action(path, data?)` | `POST /resource/:path` | Custom action  |

---

## 🧪 Error Handling Patterns

```ts
const res = await api.getOne("/users/999");

if (!res.status) {
  switch (res.data.statusCode) {
    case 404:
      console.warn("Not found");
      break;
    case 500:
      console.error("Server error");
      break;
    default:
      console.error(res.data.message);
  }
}
```

Async/await pattern:

```ts
async function loadUser(id: string) {
  const res = await api.getOne(`/users/${id}`);
  return res.status ? res.data : null;
}
```

---

## 🔐 Authentication

```ts
const api = withAuth({
  authHeaders: { Authorization: `Bearer ${getToken()}` },
  onAuthError: async (err, instance) => {
    const newToken = await refreshToken();
    instance.defaults.headers.Authorization = `Bearer ${newToken}`;
    return instance.request(err.config);
  },
});
```

Also supports custom headers:

```ts
const apiKeyClient = withAuth({
  authHeaders: { "X-API-Key": "abc123" },
});
```

---

## 🧩 Interceptors

```ts
const api = withAuth({
  onRequest: (cfg) => {
    console.log("Request:", cfg.method?.toUpperCase(), cfg.url);
    return cfg;
  },
  onResponse: (res) => {
    console.log("Response:", res.status);
  },
  onError: (err) => {
    console.log("Error:", err.message);
  },
});
```

---

## ⚙️ Environment Variables

```bash
REACT_APP_API_URL=https://api.example.com
```

```ts
const api = withAuth({ baseURL: process.env.REACT_APP_API_URL });
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

_Document version: 4_  
_Last update: 01-11-2025_
