/**
 * Marca um usuário como super-admin da plataforma (acesso ao painel /admin).
 * Uso: npx tsx scripts/make-super-admin.ts seu@email.com
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Informe o email: npx tsx scripts/make-super-admin.ts seu@email.com')
    process.exit(1)
  }
  const user = await prisma.user.update({
    where: { email },
    data: { isSuperAdmin: true },
    select: { id: true, name: true, email: true, isSuperAdmin: true },
  }).catch(() => null)

  if (!user) {
    console.error(`Usuário não encontrado: ${email}`)
    process.exit(1)
  }
  console.log('✔ Super-admin definido:', user)
  console.log('→ Faça logout/login para o novo token carregar a permissão.')
}

main().finally(() => prisma.$disconnect())
