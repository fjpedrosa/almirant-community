import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";

export async function GET() {
  try {
    const session = await getServerSession();

    if (!session) {
      return NextResponse.json({ token: null }, { status: 401 });
    }

    return NextResponse.json({ token: session.session.token });
  } catch (error) {
    console.error("[ws-token] Failed to resolve session", error);
    return NextResponse.json({ token: null }, { status: 500 });
  }
}
