import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineEye, HiArrowLeft, HiX } from 'react-icons/hi';
import toast from 'react-hot-toast';

export default function Admin() {
  const { state, dispatch } = useStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [editingProduct, setEditingProduct] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const fileInputRef = useRef(null);
  
  const [form, setForm] = useState({
    name: '', brand: 'MJ Store', price: '', category: 'sneakers', description: '',
    stock: '', tag: '', material: '', sole: '',
  });
  const [images, setImages] = useState([]);

  if (!state.user || state.user.role !== 'admin') {
    return (
      <main className="pt-16">
        <div className="container-main py-20 text-center">
          <h2 className="text-2xl font-light tracking-tight mb-4">Admin Access Required</h2>
          <p className="text-sm text-neutral-400 mb-6">Sign in with admin credentials.</p>
          <Link to="/login" className="btn-primary text-xs">Sign In</Link>
        </div>
      </main>
    );
  }

  const totalRevenue = state.orders?.reduce((sum, o) => sum + (o.total || o.totalAmount), 0) || 0;
  const lowStock = state.products?.filter(p => p.stock <= 5) || [];
  const tabs = ['overview', 'products', 'orders'];

  const openNew = () => {
    setEditingProduct(null);
    setForm({ name: '', brand: 'MJ Store', price: '', category: 'sneakers', description: '', stock: '', tag: '', material: '', sole: '' });
    setImages([]);
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditingProduct(p);
    setForm({
      name: p.name, brand: p.brand || 'MJ Store', price: p.price.toString(), category: p.category,
      description: p.description, stock: p.stock.toString(),
      tag: p.tag || '', material: p.material || '', sole: p.sole || '',
    });
    setImages([]); // we rely on existing images if new ones aren't uploaded
    setShowModal(true);
  };

  const handleImageChange = (e) => {
    if (e.target.files) {
      setImages(Array.from(e.target.files));
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.price || !form.stock) {
      toast.error('Fill required fields', { style: { fontSize: '13px' } });
      return;
    }

    setLoadingAction(true);
    try {
      const { collection, addDoc, doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      
      const productData = { ...form };
      productData.price = Number(productData.price);
      productData.stock = Number(productData.stock);
      productData.rating = editingProduct ? editingProduct.rating : 5;
      productData.reviews = editingProduct ? editingProduct.reviews : 0;
      productData.colors = editingProduct?.colors || ['Default'];
      productData.sizes = editingProduct?.sizes || [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12];
      productData.images = editingProduct?.images || ['/images/shoe-white.png'];

      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id || editingProduct._id), productData);
        const mappedData = { ...productData, id: editingProduct.id || editingProduct._id };
        dispatch({ type: 'EDIT_PRODUCT', payload: mappedData });
        toast.success('Product updated', { style: { fontSize: '13px' } });
      } else {
        productData.createdAt = new Date().toISOString();
        const docRef = await addDoc(collection(db, 'products'), productData);
        const mappedData = { ...productData, id: docRef.id };
        dispatch({ type: 'ADD_PRODUCT', payload: mappedData });
        toast.success('Product added', { style: { fontSize: '13px' } });
      }
      setShowModal(false);
    } catch (error) {
      console.error(error);
      toast.error('Error saving product', { style: { fontSize: '13px' } });
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this product?')) {
      try {
        const { doc, deleteDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        await deleteDoc(doc(db, 'products', id));
        dispatch({ type: 'DELETE_PRODUCT', payload: id });
        toast.success('Product deleted', { style: { fontSize: '13px' } });
      } catch (error) {
        console.error(error);
        toast.error('Error deleting product', { style: { fontSize: '13px' } });
      }
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await updateDoc(doc(db, 'orders', orderId), { status: newStatus });
      dispatch({ type: 'SET_ORDERS', payload: state.orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o) });
      toast.success('Order status updated', { style: { fontSize: '13px' } });
    } catch (error) {
      console.error(error);
      toast.error('Failed to update status', { style: { fontSize: '13px' } });
    }
  };

  return (
    <main className="pt-16 bg-neutral-50 min-h-screen">
      <div className="container-main py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-neutral-400 hover:text-neutral-900 transition-base">
              <HiArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-medium tracking-tight">Admin Dashboard</h1>
              <p className="text-xs text-neutral-400">{state.user.email}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-neutral-200">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-xs uppercase tracking-widest transition-base border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-400 hover:text-neutral-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6 fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Revenue', value: `₹${Math.round(totalRevenue).toLocaleString('en-IN')}` },
                { label: 'Products', value: state.products?.length || 0 },
                { label: 'Orders', value: state.orders?.length || 0 },
                { label: 'Low Stock', value: lowStock.length },
              ].map(stat => (
                <div key={stat.label} className="bg-white border border-neutral-100 p-6">
                  <p className="text-xs text-neutral-400 uppercase tracking-widest mb-2">{stat.label}</p>
                  <p className="text-2xl font-medium">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Sales Chart */}
            <div className="bg-white border border-neutral-100 p-6">
              <h3 className="text-xs uppercase tracking-widest font-medium mb-6">Monthly Sales</h3>
              <div className="flex items-end gap-2 h-40">
                {[35, 55, 40, 70, 50, 85, 60, 75, 55, 65, 80, 45].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <div
                      className="w-full bg-neutral-900 transition-all duration-300 hover:bg-neutral-700"
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-neutral-400">
                      {['J','F','M','A','M','J','J','A','S','O','N','D'][i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Low Stock */}
            {lowStock.length > 0 && (
              <div className="bg-white border border-neutral-100 p-6">
                <h3 className="text-xs uppercase tracking-widest font-medium mb-4">Low Stock Alerts</h3>
                <div className="space-y-3">
                  {lowStock.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-neutral-50">
                          <img src={p.images?.[0] || '/images/shoe-white.png'} alt={p.name} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="text-sm">{p.name}</p>
                          <p className="text-xs text-red-500">{p.stock} remaining</p>
                        </div>
                      </div>
                      <button onClick={() => openEdit(p)} className="text-xs text-neutral-400 hover:text-neutral-900 transition-base">
                        Update
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Products */}
        {activeTab === 'products' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium">All Products ({state.products?.length || 0})</h2>
              <button onClick={openNew} className="btn-primary text-xs flex items-center gap-2">
                <HiOutlinePlus className="w-3 h-3" /> Add Product
              </button>
            </div>

            <div className="bg-white border border-neutral-100 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50">
                    <th className="text-left text-[10px] text-neutral-400 uppercase tracking-widest p-4">Product</th>
                    <th className="text-left text-[10px] text-neutral-400 uppercase tracking-widest p-4 hidden sm:table-cell">Category</th>
                    <th className="text-left text-[10px] text-neutral-400 uppercase tracking-widest p-4">Price</th>
                    <th className="text-left text-[10px] text-neutral-400 uppercase tracking-widest p-4">Stock</th>
                    <th className="text-right text-[10px] text-neutral-400 uppercase tracking-widest p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.products?.map(p => (
                    <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50 transition-base">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-neutral-50 flex-shrink-0">
                            <img src={p.images?.[0] || '/images/shoe-white.png'} alt={p.name} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <p className="text-sm">{p.name}</p>
                            {p.tag && <p className="text-[10px] text-neutral-400">{p.tag}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-xs text-neutral-500 capitalize hidden sm:table-cell">{p.category}</td>
                      <td className="p-4 text-sm">₹{Number(p.price).toLocaleString('en-IN')}</td>
                      <td className="p-4">
                        <span className={`text-sm ${p.stock === 0 ? 'text-red-600 font-bold' : p.stock <= 5 ? 'text-red-500' : 'text-neutral-900'}`}>
                          {p.stock === 0 ? 'Out of Stock' : p.stock}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/product/${p.id}`} className="p-2 text-neutral-300 hover:text-neutral-900 transition-base">
                            <HiOutlineEye className="w-4 h-4" />
                          </Link>
                          <button onClick={() => openEdit(p)} className="p-2 text-neutral-300 hover:text-neutral-900 transition-base">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(p.id)} className="p-2 text-neutral-300 hover:text-red-500 transition-base">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Orders */}
        {activeTab === 'orders' && (
          <div className="fade-in">
            <h2 className="text-sm font-medium mb-6">All Orders ({state.orders?.length || 0})</h2>
            {(!state.orders || state.orders.length === 0) ? (
              <div className="bg-white border border-neutral-100 p-12 text-center">
                <p className="text-sm text-neutral-400">No orders yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {state.orders.map(order => (
                  <div key={order.id} className="bg-white border border-neutral-100 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-xs font-mono font-medium">{order.id}</p>
                        <p className="text-[11px] text-neutral-400 mt-0.5">{new Date(order.date).toLocaleString()}</p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-2">
                        <p className="text-sm font-medium">₹{Number(order.total).toLocaleString('en-IN')}</p>
                        <select 
                          className="text-[11px] font-medium uppercase tracking-widest bg-transparent border-b border-neutral-300 py-1"
                          value={order.status || 'pending'}
                          onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                        >
                          <option value="pending">Pending</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="processing">Processing</option>
                          <option value="shipped">Shipped</option>
                          <option value="delivered">Delivered</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {order.items.map(item => (
                        <div key={`${item.id}-${item.size}`} className="flex items-center gap-2 bg-neutral-50 p-2 pr-4">
                          <div className="w-8 h-8 bg-white">
                            <img src={item.image || '/images/shoe-white.png'} alt={item.name} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <p className="text-xs">{item.name}</p>
                            <p className="text-[10px] text-neutral-400">Size {item.size} × {item.quantity}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {order.shippingAddress && (
                      <p className="text-xs text-neutral-400 mt-4 pt-4 border-t border-neutral-50">
                        Ships to: {order.shippingAddress.firstName} {order.shippingAddress.lastName}, {order.shippingAddress.city}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowModal(false)} />
          <div className="relative bg-white p-8 w-full max-w-lg max-h-[80vh] overflow-y-auto fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium">{editingProduct ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => setShowModal(false)} className="text-neutral-400 hover:text-neutral-900">
                <HiX className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input-field" disabled={loadingAction} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-neutral-400 mb-1.5 block">Price *</label>
                  <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className="input-field" disabled={loadingAction} />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1.5 block">Stock *</label>
                  <input type="number" value={form.stock} onChange={e => setForm(p => ({ ...p, stock: e.target.value }))} className="input-field" disabled={loadingAction} />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Category</label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className="input-field" disabled={loadingAction}>
                  <option value="sneakers">Sneakers</option>
                  <option value="sports">Sports</option>
                  <option value="casual">Casual</option>
                  <option value="limited">Limited Edition</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="input-field h-20 resize-none" disabled={loadingAction} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-neutral-400 mb-1.5 block">Material</label>
                  <input value={form.material} onChange={e => setForm(p => ({ ...p, material: e.target.value }))} className="input-field" disabled={loadingAction} />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1.5 block">Sole</label>
                  <input value={form.sole} onChange={e => setForm(p => ({ ...p, sole: e.target.value }))} className="input-field" disabled={loadingAction} />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Images</label>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*"
                  onChange={handleImageChange}
                  className="input-field" 
                  disabled={loadingAction}
                  style={{ display: 'block', padding: '10px' }}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleSave} className="btn-primary flex-1 text-xs disabled:opacity-50" disabled={loadingAction}>
                  {loadingAction ? 'Saving...' : (editingProduct ? 'Update' : 'Add Product')}
                </button>
                <button onClick={() => setShowModal(false)} className="btn-outline flex-1 text-xs" disabled={loadingAction}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
