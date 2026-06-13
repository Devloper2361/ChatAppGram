import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const password_hash = await bcrypt.hash('demo123', 12)
  
  const user1 = await prisma.user.upsert({
    where: { username: 'demo1' },
    update: {},
    create: {
      username: 'demo1',
      email: 'demo1@example.com',
      password_hash,
    },
  })
  
  const user2 = await prisma.user.upsert({
    where: { username: 'demo2' },
    update: {},
    create: {
      username: 'demo2',
      email: 'demo2@example.com',
      password_hash,
    },
  })
  
  console.log('Seeded users:', { user1: user1.username, user2: user2.username })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
