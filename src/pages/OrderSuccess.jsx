import { Link } from 'react-router-dom';
import { HiOutlineCheckCircle } from 'react-icons/hi';

export default function OrderSuccess() {
  return (
    <main className="pt-16">
      <div className="container-main py-20 md:py-28 text-center max-w-lg mx-auto">
        <HiOutlineCheckCircle className="w-12 h-12 text-neutral-900 mx-auto mb-6" />
        <h1 className="text-2xl font-light tracking-tight mb-3">Order Confirmed</h1>
        <p className="text-sm text-neutral-500 leading-relaxed mb-8">
          Thank you for your purchase. We have received your order and will begin 
          preparing it shortly. A confirmation email has been sent to you.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/shop" className="btn-primary text-xs">Continue Shopping</Link>
          <Link to="/account" className="btn-outline text-xs">View My Orders</Link>
        </div>
      </div>
    </main>
  );
}
