-- Preserve canonical import values and unknown or missing areas. Normalize the two legacy choices.
UPDATE listings SET area = CASE area
  WHEN 'Downtown' THEN 'Downtown Dubai'
  WHEN 'Delivers across Dubai' THEN 'Delivery only'
END
WHERE kind IN ('place', 'service') AND area IN ('Downtown', 'Delivers across Dubai');
