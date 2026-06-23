import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ token: null }, { status: 401 });
    }

    return NextResponse.json({ token: session.session.token });
  } catch (error) {
    console.error("[ws-token] Failed to resolve session", error);
    return NextResponse.json({ token: null }, { status: 500 });
  }
}
