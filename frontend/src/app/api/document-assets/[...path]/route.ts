import { type NextRequest, NextResponse } from "next/server";

const resolveBackendOrigin = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return backendUrl.replace(/\/+$/, "");
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl) {
    return publicApiUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  }

  return "http://localhost:3001";
};

const BACKEND_ORIGIN = resolveBackendOrigin();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const backendUrl = `${BACKEND_ORIGIN}/api/document-assets/${encodedPath}`;

  try {
    const response = await fetch(backendUrl);
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "text/plain";
      const cacheControl =
        response.headers.get("cache-control") || "no-store";
      const body = await response.arrayBuffer();
      return new NextResponse(body, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        },
      });
    }
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const cacheControl =
      response.headers.get("cache-control") || "public, max-age=86400";
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
