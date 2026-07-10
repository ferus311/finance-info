"use client";
import { redirect } from 'next/navigation';

const Home = () => {
    // redirect to /dashboard/newsfeed
    redirect('/dashboard');
}

export default Home;
