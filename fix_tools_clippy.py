with open("rust/crates/tools/src/supabase_ops.rs", "r") as f:
    text = f.read()

text = text.replace('format!("Bearer {}", supabase_key)', 'format!("Bearer {supabase_key}")')
text = text.replace('format!("{}/storage/v1/object/{}/{}", supabase_url, bucket, input.filename)', 'format!("{supabase_url}/storage/v1/object/{bucket}/{}")')
text = text.replace('format!("{}/storage/v1/object/sign/{}/{}", supabase_url, bucket, input.filename)', 'format!("{supabase_url}/storage/v1/object/sign/{bucket}/{}")')
text = text.replace('format!("{}{}", supabase_url, signed_url)', 'format!("{supabase_url}{signed_url}")')

with open("rust/crates/tools/src/supabase_ops.rs", "w") as f:
    f.write(text)
