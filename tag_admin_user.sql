-- ============================================================================
-- tag_admin_user.sql
-- Creates/updates user deshmukhparth14@gmail.com (pass: admin1234)
-- and tags 100% of existing portfolio, watchlist & paper data to this user.
-- ============================================================================

-- 1. Ensure paper_portfolio_config has auto-incrementing ID sequence
CREATE SEQUENCE IF NOT EXISTS paper_portfolio_config_id_seq START WITH 100;
ALTER TABLE public.paper_portfolio_config ALTER COLUMN id SET DEFAULT nextval('paper_portfolio_config_id_seq');

-- 2. Fix the handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- If there is an unassigned paper config, tag it
    IF EXISTS (SELECT 1 FROM public.paper_portfolio_config WHERE user_id IS NULL) THEN
        UPDATE public.paper_portfolio_config SET user_id = NEW.id WHERE user_id IS NULL;
    -- Otherwise insert new paper portfolio config
    ELSIF NOT EXISTS (SELECT 1 FROM public.paper_portfolio_config WHERE user_id = NEW.id) THEN
        INSERT INTO public.paper_portfolio_config (user_id, initial_capital, current_cash, realized_pnl)
        VALUES (NEW.id, 5000000.00, 5000000.00, 0.00);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
DECLARE
    target_user_id UUID;
BEGIN
    -- 3. Resolve or Create User in auth.users
    SELECT id INTO target_user_id FROM auth.users WHERE email = 'deshmukhparth14@gmail.com';
    
    IF target_user_id IS NULL THEN
        target_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            target_user_id,
            'authenticated',
            'authenticated',
            'deshmukhparth14@gmail.com',
            crypt('admin1234', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{}'::jsonb,
            NOW(),
            NOW(),
            '',
            '',
            '',
            ''
        );

        INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            provider_id,
            last_sign_in_at,
            created_at,
            updated_at
        ) VALUES (
            target_user_id,
            target_user_id,
            jsonb_build_object('sub', target_user_id::text, 'email', 'deshmukhparth14@gmail.com'),
            'email',
            target_user_id::text,
            NOW(),
            NOW(),
            NOW()
        );
    ELSE
        -- Update password and ensure email is confirmed
        UPDATE auth.users 
        SET encrypted_password = crypt('admin1234', gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW())
        WHERE id = target_user_id;
    END IF;

    -- 4. Tag all portfolio data to this user
    UPDATE public.transactions SET user_id = target_user_id;
    UPDATE public.mf_sip_configs SET user_id = target_user_id;
    UPDATE public.watchlist_items SET user_id = target_user_id;
    UPDATE public.paper_portfolio_config SET user_id = target_user_id;
    UPDATE public.paper_assets SET user_id = target_user_id;
    UPDATE public.paper_transactions SET user_id = target_user_id;

    RAISE NOTICE 'SUCCESS: All portfolio tables tagged to user deshmukhparth14@gmail.com (ID: %)', target_user_id;
END $$;
