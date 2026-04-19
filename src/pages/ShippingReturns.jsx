export default function ShippingReturns() {
  return (
    <main className="pt-24 pb-16 min-h-[80vh]">
      <div className="container-main max-w-3xl">
        <h1 className="text-3xl font-light tracking-tight mb-8">Shipping & Returns</h1>
        
        <section className="mb-12">
          <h2 className="text-xl font-medium tracking-tight mb-4">Delivery Guidelines</h2>
          <p className="text-neutral-500 mb-6 leading-relaxed">
            We partner with premium logistics services to ensure your footwear arrives securely and promptly. Currently, we offer nationwide shipping across India.
          </p>
          <ul className="list-disc pl-5 text-neutral-500 space-y-3">
            <li><strong>Standard Shipping:</strong> 5-7 business days (₹199 or Free on orders over ₹4999)</li>
            <li><strong>Express Shipping:</strong> 2-3 business days (₹499)</li>
            <li>Orders placed before 12:00 PM IST are processed the same business day.</li>
          </ul>
        </section>

        <div className="divider my-10" />

        <section className="mb-12">
          <h2 className="text-xl font-medium tracking-tight mb-4">Return Policy</h2>
          <p className="text-neutral-500 mb-6 leading-relaxed">
            We guarantee absolute satisfaction. If your purchase doesn't feel right, you can return it within 14 days of delivery.
          </p>
          <ul className="list-disc pl-5 text-neutral-500 space-y-3">
            <li>Shoes must be unworn, in their original condition, and with all tags attached.</li>
            <li>The original shoebox must be undamaged and returned within the protective shipping box.</li>
            <li>Items marked as "Final Sale" cannot be returned or exchanged.</li>
          </ul>
        </section>

        <div className="divider my-10" />

        <section>
          <h2 className="text-xl font-medium tracking-tight mb-4">Refund Process</h2>
          <p className="text-neutral-500 leading-relaxed">
            Once we receive and inspect your returned item, we will notify you of the approval or rejection of your refund. Approved refunds are processed automatically back to your original Razorpay payment method within 5-7 business days. 
          </p>
        </section>
      </div>
    </main>
  );
}
