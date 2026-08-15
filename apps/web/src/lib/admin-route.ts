export function getAdminBasePath(pathname: string) {
  const [firstSegment] = pathname.split('/').filter(Boolean)
  return firstSegment ? `/${firstSegment}` : ''
}
