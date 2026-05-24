const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/webp",
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const PUBLIC_DOMAIN = "tattty-uploads.tattty.com";

const shortId = () => Math.random().toString(36).substring(2, 10);

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const contentType = request.headers.get("Content-Type") || "";

    // ── JSON body: image URLs + userId ──
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const userId = body.userId;

      if (!userId) {
        return new Response(JSON.stringify({ error: "userId is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const urls = [];
      for (const [key, value] of Object.entries(body)) {
        if (key.startsWith("image_URL_") && value) {
          urls.push(value);
        }
      }

      if (urls.length === 0) {
        return new Response(
          JSON.stringify({ error: "No image URLs provided" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return await handleImageUrls(urls, userId, env, body);
    }

    // ── Multipart upload (local file) ──
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file field in form data" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      return await handleFile(file, env);
    }

    return new Response(
      JSON.stringify({ error: "Send JSON or multipart/form-data" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};

// ── Handle image URLs: download, upload to R2 under userId folder ──
async function handleImageUrls(urls, userId, env, body) {
  const style = body.style || "default";
  const color = body.color || "default";
  const customerId = body.customerId || userId;
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const imageUrl = urls[i];
    const response = await fetch(imageUrl);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch image: ${imageUrl}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const contentType = response.headers.get("Content-Type") || "";
    const urlExt = imageUrl.split(".").pop().split("?")[0].toLowerCase();
    const ext = ALLOWED_IMAGE_EXTENSIONS.has(urlExt)
      ? urlExt
      : contentType.split("/")[1];

    if (
      !ALLOWED_IMAGE_TYPES.has(contentType) &&
      !ALLOWED_IMAGE_EXTENSIONS.has(urlExt)
    ) {
      return new Response(
        JSON.stringify({
          error: `Invalid image type: ${contentType || urlExt}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const key = `images/${style}/${color}/${customerId}-${i}.${ext}`;
    const arrayBuffer = await response.arrayBuffer();

    await env.GEN_BUCKET.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: contentType || `image/${ext}`,
      },
      customMetadata: {
        originalUrl: imageUrl,
        uploadedAt: new Date().toISOString(),
      },
    });

    results.push(`https://${PUBLIC_DOMAIN}/${key}`);
  }

  return new Response(JSON.stringify({ urls: results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Handle local file uploads ──
async function handleFile(file, env) {
  const fileExt = file.name.split(".").pop().toLowerCase();
  const isImage =
    ALLOWED_IMAGE_TYPES.has(file.type) || ALLOWED_IMAGE_EXTENSIONS.has(fileExt);

  if (!isImage) {
    return new Response(
      JSON.stringify({ error: "Only images (png, jpg, jpeg, webp) allowed" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const MAX_SIZE = 100 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return new Response(JSON.stringify({ error: "Max file size is 100MB" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = `images/${shortId()}.${fileExt}`;

  await env.GEN_BUCKET.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
    },
  });

  const url = `https://${PUBLIC_DOMAIN}/${key}`;

  return new Response(
    JSON.stringify({
      url,
      key,
      type: "image",
      size: file.size,
      originalName: file.name,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
