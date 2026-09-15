import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Misafir siparişini hesaba bağlamak.
 *
 * Üyelik zorunlu değil ve olmayacak: sipariş vermenin önüne konan her adım
 * sepeti terk ettiriyor. Bunun bedeli, çoğu müşterinin ilk siparişini misafir
 * olarak vermesi ve sonradan hesap açtığında geçmişini boş bulması. O sipariş
 * kayıtta `customerId = null` ile duruyor — sahibi belli ama bağı yok.
 *
 * Bağlamanın koşulu **iki bilginin birden** doğru olması: sipariş numarası ve
 * o siparişte verilen telefon numarası. İkisi ayrı sebeplerden gerekli:
 *
 *  - Sipariş numarası tek başına yeterli değil: numaralar gün içinde sıralı ve
 *    tahmin edilebilir ("SD-260907-001"). Yalnızca numara istemek, sırayla
 *    deneyen birinin başkalarının siparişlerini — adresiyle, telefonuyla —
 *    kendi hesabına toplamasına izin verirdi.
 *  - Telefon tek başına da yeterli değil: aynı numaradan verilmiş bütün
 *    siparişleri getirmek, numarayı bilen birine o kişinin tüm geçmişini
 *    verirdi.
 *
 * Telefon karşılaştırması **normalize edilerek** yapılır: müşteri o gün
 * "0170 1234567" yazmış olabilir, bugün "+49 170 1234567" yazar. Rakamlar
 * aynıysa aynı numaradır; biçim farkı yüzünden kendi siparişini alamamak,
 * kuralın koruduğu şeyle ilgisi olmayan bir engel olurdu.
 */

export const claimSchema = z.object({
  orderNo: z.string().trim().min(3).max(40),
  phone: z.string().trim().min(6).max(24),
});

export type ClaimInput = z.infer<typeof claimSchema>;

/**
 * Telefon numarasını karşılaştırılabilir hâle getirir.
 *
 * Yalnızca rakamlar tutulur, Almanya için ülke kodu ve baştaki sıfır atılır:
 * "+49 170 1234567", "0049 170 1234567" ve "0170 1234567" aynı numaradır ve
 * üçü de "1701234567" olur.
 */
export function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0049")) digits = digits.slice(4);
  else if (digits.startsWith("49") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export type ClaimResult =
  | { ok: true; orderNo: string }
  | { ok: false; reason: "not_found" | "already_claimed" | "phone_mismatch" };

/**
 * Siparişi hesaba bağlar.
 *
 * Yalnızca `customerId` yazılır; siparişin başka hiçbir alanına dokunulmaz.
 * Sipariş kayıtları append-only ve bu bağ, kaydın kendisini değil yalnızca
 * "kimin hesabında görüneceğini" belirliyor. Adres ve ad siparişin içindeki
 * kopyalardır ve öyle kalır — o akşam yemek nereye gittiyse orada yazar.
 */
export async function claimGuestOrder(
  customerId: string,
  input: ClaimInput
): Promise<ClaimResult> {
  const order = await prisma.order.findUnique({
    where: { orderNo: input.orderNo },
    select: { id: true, orderNo: true, customerId: true, phone: true },
  });
  if (!order) return { ok: false, reason: "not_found" };

  /*
   * Zaten bağlı bir sipariş **hiçbir koşulda** el değiştirmez.
   *
   * Kendi hesabına zaten bağlıysa bu bir hata değil, tekrar denemedir ve
   * başarılı sayılır. Başkasının hesabına bağlıysa hiçbir şey yapılmaz ve
   * cevap "böyle bir sipariş bulunamadı" ile aynıdır: "bu sipariş başkasının"
   * demek, numaranın gerçek olduğunu doğrulamak olurdu.
   */
  if (order.customerId) {
    return order.customerId === customerId
      ? { ok: true, orderNo: order.orderNo }
      : { ok: false, reason: "already_claimed" };
  }

  const given = normalizePhone(input.phone);
  // Siparişte telefon yoksa (eski kayıt) eşleşme kurulamaz; tahmin edilebilir
  // bir numarayla bağlanmasına izin vermektense bağlanmaması doğru.
  if (given.length < 6 || normalizePhone(order.phone) !== given) {
    return { ok: false, reason: "phone_mismatch" };
  }

  await prisma.order.update({ where: { id: order.id }, data: { customerId } });
  return { ok: true, orderNo: order.orderNo };
}
