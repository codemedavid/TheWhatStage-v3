-- =========================================================================
-- WhatStage University — Quickstart Course seed
--
-- Converts all 11 dashboard tutorial videos (Loom) into a free, publicly
-- accessible course so anyone can watch them at /university without logging in.
-- access_level = 'public'  → every lesson playable by anon & authenticated.
-- =========================================================================

do $$
declare
  v_cat_id  uuid;
  v_course  uuid;

  v_slugs text[] := array[
    'overview-what-youll-set-up',
    'welcome-setting-up-your-knowledge',
    'create-your-chatbot-personality',
    'write-instructions-for-your-chatbot',
    'connect-your-facebook-page',
    'send-images-to-your-messenger-leads',
    'action-pages-explained',
    'create-a-booking-action-page',
    'add-an-action-page-to-your-conversation-flow',
    'lead-management-and-auto-sort-explained',
    'set-up-automated-follow-ups'
  ];

  v_titles text[] := array[
    'Overview: what you''ll set up',
    'Welcome & setting up your knowledge',
    'Create your chatbot personality',
    'Write instructions for your chatbot',
    'Connect your Facebook page',
    'Send images to your Messenger leads',
    'Action pages, explained',
    'Create a booking action page',
    'Add an action page to your conversation flow',
    'Lead management & auto-sort, explained',
    'Set up automated follow-ups'
  ];

  v_summaries text[] := array[
    'A quick tour of everything you''ll set up in WhatStage — knowledge, chatbot, action pages, and channels.',
    'A tour of your dashboard and how to set up the knowledge that powers your chatbot.',
    'Give your chatbot a voice and personality that matches your brand.',
    'Add instructions that guide how your chatbot responds to leads.',
    'Link your Facebook business page to WhatStage so your AI can reply on Messenger.',
    'Organise media into folders and train the bot with hashtags so it sends the right image on request.',
    'A tour of every action page type — forms, bookings, quizzes, sales pages, catalogues, and listings.',
    'Build and configure a booking page — availability hours and form fields included.',
    'Link an action page into your chatbot flow and instructions so it triggers at the right moment.',
    'See how leads are organised by stage — qualified, contacted, unqualified — and auto-sorted as they come in.',
    'Let the AI follow up automatically — up to 7 touchpoints at timed intervals until the lead replies.'
  ];

  v_durations integer[] := array[
    140,
    668,
    414,
    280,
    164,
    319,
    202,
    386,
    214,
    233,
    101
  ];

  v_loom_ids text[] := array[
    '3ff493165d1c421cbc204a6122e21288',
    '6a9d2bdb59954e4eb68ed860ad09bd95',
    'fc339f11b00d468bacb5cd0ec956ce34',
    '99dc0b13bf40430ba34bc52eef6c6b79',
    '489ca20051c3425fb02cca59657e1384',
    '8f92982ae6b74dea87dfafe8898376d1',
    'c66861d539c94655a3ee0b26a335315b',
    'a21f9b5d099f4a20be77467584b6cf9f',
    '8a191bb710c148d8a0f499c78d86da58',
    '013e82146f8e47688cdcd52311d69117',
    '7d3b2da420394d52990638f1b15389f6'
  ];

  v_lesson_id uuid;
  i           integer;
begin
  select id into v_cat_id
  from public.university_categories
  where slug = 'getting-started';

  insert into public.university_courses
    (slug, title, subtitle, description, category_id, access_level, status, position, published_at)
  values (
    'whatstage-quickstart',
    'WhatStage Quickstart',
    'Get up and running fast — 11 short videos covering the full platform.',
    'Everything you need to launch your AI-powered chatbot: set up your knowledge base, '
    'build your chatbot personality, connect Facebook Messenger, create action pages, manage leads, '
    'and turn on automated follow-ups. Free for everyone — no account required.',
    v_cat_id,
    'public',
    'published',
    0,
    now()
  )
  on conflict (slug) do nothing
  returning id into v_course;

  if v_course is null then
    select id into v_course from public.university_courses where slug = 'whatstage-quickstart';
  end if;

  for i in 1..array_length(v_slugs, 1) loop
    insert into public.university_lessons
      (course_id, slug, title, summary, provider, duration_seconds, position, is_preview)
    values
      (v_course, v_slugs[i], v_titles[i], v_summaries[i], 'loom', v_durations[i], i - 1, false)
    on conflict (course_id, slug) do nothing
    returning id into v_lesson_id;

    if v_lesson_id is not null then
      insert into public.university_lesson_sources
        (lesson_id, course_id, provider, provider_video_id, provider_hash, source_path)
      values
        (v_lesson_id, v_course, 'loom', v_loom_ids[i], null, null)
      on conflict (lesson_id) do update
        set provider_video_id = excluded.provider_video_id,
            updated_at        = now();
    end if;
  end loop;
end;
$$;
