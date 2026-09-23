-- The structured menu the menu card draws from and the cart orders against,
-- and the orders visitors place. Both additive; nothing existing changes.
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MenuItem_userId_key_key" ON "MenuItem"("userId", "key");
CREATE INDEX "MenuItem_userId_idx" ON "MenuItem"("userId");
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lines" TEXT NOT NULL DEFAULT '[]',
    "contact" TEXT NOT NULL DEFAULT '{}',
    "fulfillment" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "subtotal" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
