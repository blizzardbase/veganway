// Add a product: name with a duplicate check, where to buy it, then optional extras.
// Route: /add/product, signed in (RequireAccount). Default export: AddRoute lazy loads it.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Leaf, ThumbsUp } from 'lucide-react';
import { Button, Chip, Field, StickyBar, TopBar, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateListing } from './api';
import { ChoiceChips } from './bits';
import { DuplicateHint } from './Typeahead';
import { PhotoPicker } from './PhotoPicker';
import { BODY_MAX, NAME_MAX, PRODUCT_CATEGORIES, STORES, listingPath, type PhotoResponse } from '../../../shared/types/listings';

type Store = (typeof STORES)[number];
type Errors = Partial<Record<'name' | 'stores' | 'whatToOrder' | 'form', string>>;

export default function AddProductForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateListing();
  const [name, setName] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [recommend, setRecommend] = useState(false);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PhotoResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (name.trim().length < 2) local.name = 'Enter the product name.';
    if (stores.length === 0) local.stores = 'Choose at least one store.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const { listing } = await create.mutateAsync({
        kind: 'product',
        name: name.trim(),
        stores,
        veganStatus: 'vegan_product',
        category: category[0],
        whatToOrder: note.trim() || undefined,
        opinion: recommend ? 'recommend' : null,
        photoId: photo?.id,
      });
      toast.show({ message: 'Added. Thank you for sharing.' });
      navigate(listingPath(listing), { replace: true });
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const key = field === 'name' || field === 'stores' || field === 'whatToOrder' ? field : 'form';
      setErrors({ [key]: errorMessage(err) });
    }
  };

  return (
    <>
      <TopBar title="Add a product" back />
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Field label="Product name" value={name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} error={errors.name} />
          <DuplicateHint name={name} kind="product" />
        </div>

        <ChoiceChips<Store> label="Where to buy it" options={STORES} value={stores} onChange={setStores} multiple error={errors.stores} />

        <ChoiceChips label="Type (optional)" options={PRODUCT_CATEGORIES} value={category} onChange={setCategory} />

        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Leaf size={16} aria-hidden="true" className="text-ink" />
            Listed as a vegan product.
          </p>
          <Chip selected={recommend} onClick={() => setRecommend(!recommend)} icon={<ThumbsUp size={16} aria-hidden="true" />} className="w-fit">
            I recommend it
          </Chip>
        </div>

        <Field
          multiline
          label="Why you like it (optional)"
          value={note}
          maxLength={BODY_MAX}
          onChange={(e) => setNote(e.target.value)}
          error={errors.whatToOrder}
          hint="No phone numbers or email addresses, please."
          inputClassName="min-h-20"
        />

        <PhotoPicker value={photo} onChange={setPhoto} onBusy={setUploading} />

        <StickyBar>
          {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Adding" disabled={uploading}>Add product</Button>
        </StickyBar>
      </form>
    </>
  );
}
