const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const PUBLIC_DOMAIN = "tattty-uploads.tattty.com";

export default {
  async fetch(request, env) {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const customerId = body.customerId;
    const style = body.style.replace(/\s+/g, "-");
    const color = body.color.replace(/\s+/g, "-");

    const urls = [];
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith("image_URL_") && value) {
        urls.push(value);
      }
    }

    return await handleImageUrls(urls, customerId, style, color, env);
  },
};

async function handleImageUrls(urls, customerId, style, color, env) {
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const imageUrl = urls[i];
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const urlExt = imageUrl.split(".").pop().split("?")[0].toLowerCase();
    const ext = ALLOWED_IMAGE_EXTENSIONS.has(urlExt) ? urlExt : "webp";

    const key = `images/${style}/${color}/${customerId}-${i}.${ext}`;

    await env.GEN_BUCKET.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: `image/${ext}`,
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
