import { NextRequest, NextResponse } from 'next/server'

const INTERNAL_ADMIN_PATH = '/admin'
const configuredAdminPath = process.env.ADMIN_PANEL_PATH?.trim() || 'central-local'
const PUBLIC_ADMIN_PATH = `/${configuredAdminPath.replace(/^\/+|\/+$/g, '')}`

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // A rota interna nunca deve responder diretamente na internet.
  if (pathname === INTERNAL_ADMIN_PATH || pathname.startsWith(`${INTERNAL_ADMIN_PATH}/`)) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    })
  }

  if (pathname === PUBLIC_ADMIN_PATH || pathname.startsWith(`${PUBLIC_ADMIN_PATH}/`)) {
    const destination = request.nextUrl.clone()
    destination.pathname = `${INTERNAL_ADMIN_PATH}${pathname.slice(PUBLIC_ADMIN_PATH.length)}`
    const response = NextResponse.rewrite(destination)
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png).*)'],
}
